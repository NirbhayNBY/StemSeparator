import logging
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

PROJECT_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = PROJECT_DIR / "uploads"
SEPARATED_DIR = PROJECT_DIR / "separated"
UPLOAD_DIR.mkdir(exist_ok=True)
SEPARATED_DIR.mkdir(exist_ok=True)

logger = logging.getLogger(__name__)
app = FastAPI()
app.mount("/static", StaticFiles(directory=PROJECT_DIR / "static"), name="static")
templates = Jinja2Templates(directory=PROJECT_DIR / "templates")

jobs: dict[str, dict[str, str]] = {}
SUPPORTED_EXTENSIONS = {".mp3", ".wav"}
STEM_NAMES = ("vocals", "drums", "bass", "other")
MODEL_NAME = "0d19c1c6"  # Use one MDX checkpoint instead of the slower four-model ensemble.


@app.get("/")
async def home(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")


def separate_song(job_id: str, filepath: Path, output_root: Path) -> None:
    job = jobs[job_id]
    job["status"] = "processing"
    output_folder = output_root / MODEL_NAME / filepath.stem

    try:
        subprocess.run(
            [
                sys.executable,
                "-m",
                "demucs.separate",
                "--name",
                MODEL_NAME,
                "--segment",
                "5",
                "--shifts",
                "0",
                "--overlap",
                "0.1",
                "--out",
                str(output_root),
                str(filepath),
            ],
            check=True,
            cwd=PROJECT_DIR,
            capture_output=True,
            text=True,
        )

        missing_stems = [
            stem for stem in STEM_NAMES
            if not (output_folder / f"{stem}.wav").is_file()
        ]
        if missing_stems:
            raise RuntimeError(
                f"Demucs did not produce the expected stems: {', '.join(missing_stems)}"
            )

        job["output_folder"] = str(output_folder)
        job["status"] = "completed"
    except (OSError, subprocess.CalledProcessError, RuntimeError) as error:
        detail = error.stderr.strip() if isinstance(error, subprocess.CalledProcessError) else str(error)
        logger.exception("Audio separation failed for job %s", job_id)
        job["status"] = "failed"
        job["error"] = detail or "Audio separation failed. Check the server log."


@app.post("/upload")
async def upload_song(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
):
    filename = Path(file.filename or "").name
    extension = Path(filename).suffix.lower()
    if not filename or extension not in SUPPORTED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Upload an MP3 or WAV audio file.")

    job_id = str(uuid.uuid4())
    filepath = UPLOAD_DIR / f"{job_id}{extension}"
    output_root = SEPARATED_DIR / job_id

    try:
        with filepath.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except OSError as error:
        logger.exception("Could not store uploaded audio file")
        raise HTTPException(status_code=500, detail="Could not save the uploaded audio file.") from error
    finally:
        await file.close()

    jobs[job_id] = {
        "status": "queued",
        "filename": filename,
    }
    background_tasks.add_task(separate_song, job_id, filepath, output_root)
    return {"job_id": job_id, "status": "queued"}


@app.get("/status/{job_id}")
def get_status(job_id: str):
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return {key: job[key] for key in ("status", "filename", "error") if key in job}


@app.get("/stems/{job_id}")
def get_stems(job_id: str):
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    if job["status"] != "completed":
        raise HTTPException(status_code=409, detail="Audio separation is not complete.")

    return {
        stem: f"/download/{job_id}/{stem}"
        for stem in STEM_NAMES
    }


@app.get("/download/{job_id}/{stem}")
def download_stem(job_id: str, stem: str):
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    if stem not in STEM_NAMES:
        raise HTTPException(status_code=404, detail="Stem not found.")
    if job["status"] != "completed":
        raise HTTPException(status_code=409, detail="Audio separation is not complete.")

    filepath = Path(job["output_folder"]) / f"{stem}.wav"
    if not filepath.is_file():
        logger.error("Expected stem file is missing: %s", filepath)
        raise HTTPException(status_code=404, detail="Stem file not found.")

    return FileResponse(
        path=filepath,
        filename=f"{stem}.wav",
        media_type="audio/wav",
    )
