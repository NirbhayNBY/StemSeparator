from fastapi import FastAPI, UploadFile, File, BackgroundTasks
from fastapi.responses import FileResponse
import shutil
import os
import subprocess
import uuid
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi import Request

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")

templates = Jinja2Templates(directory="templates")
UPLOAD_DIR = "uploads"
SEPARATED_DIR = "separated"

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(SEPARATED_DIR, exist_ok=True)

jobs = {}

@app.get("/")
async def home(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html"
    )   

def separate_song(job_id, filepath):
    try:
        jobs[job_id]["status"] = "processing"

        subprocess.run(
            ["demucs", filepath],
            check=True
        )

        song_name = os.path.splitext(
            os.path.basename(filepath)
        )[0]

        jobs[job_id]["status"] = "completed"
        jobs[job_id]["output_folder"] = (
            f"separated/htdemucs/{song_name}"
        )

    except Exception as e:
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["error"] = str(e)


@app.post("/upload")
async def upload_song(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...)
):
    filepath = os.path.join(
        UPLOAD_DIR,
        file.filename
    )

    with open(filepath, "wb") as buffer:
        shutil.copyfileobj(
            file.file,
            buffer
        )

    job_id = str(uuid.uuid4())

    jobs[job_id] = {
        "status": "queued",
        "filename": file.filename
    }

    background_tasks.add_task(
        separate_song,
        job_id,
        filepath
    )

    return {
        "job_id": job_id,
        "status": "queued"
    }


@app.get("/status/{job_id}")
def get_status(job_id: str):

    if job_id not in jobs:
        return {
            "error": "job not found"
        }

    return jobs[job_id]


@app.get("/stems/{job_id}")
def get_stems(job_id: str):

    if job_id not in jobs:
        return {"error": "job not found"}

    if jobs[job_id]["status"] != "completed":
        return {"error": "processing"}

    filename = jobs[job_id]["filename"]
    song_name = os.path.splitext(filename)[0]

    return {
        "vocals": f"/download/{job_id}/vocals",
        "drums": f"/download/{job_id}/drums",
        "bass": f"/download/{job_id}/bass",
        "other": f"/download/{job_id}/other"
    }


@app.get("/download/{job_id}/{stem}")
def download_stem(job_id: str, stem: str):

    if job_id not in jobs:
        return {"error": "job not found"}

    filename = jobs[job_id]["filename"]
    song_name = os.path.splitext(filename)[0]

    filepath = (
        f"separated/htdemucs/{song_name}/{stem}.wav"
    )

    if not os.path.exists(filepath):
        return {"error": "file not found"}

    return FileResponse(
        path=filepath,
        filename=f"{stem}.wav",
        media_type="audio/wav"
    )