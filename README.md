# StemSeparator

A local web application for separating a song into four audio stems—vocals, drums, bass, and other accompaniment—using the Demucs source-separation model. The backend is built with FastAPI and the browser interface uses HTML, CSS, and JavaScript.

## Features

- Upload an audio file from the browser.
- Process the upload in a background task with Demucs.
- Check the job status while processing.
- Listen to and download the resulting vocals, drums, bass, and other stems.

## Requirements

- Windows, macOS, or Linux.
- Python **3.11** is recommended. The pinned PyTorch 2.7.1 dependencies in `requirements.txt` support this project setup; use Python 3.11 to avoid compatibility issues.
- Internet access on the first run so Demucs can download its pretrained model.
- Enough disk space for the Python packages, downloaded model, uploaded audio, and generated WAV stems.

The app uses one pretrained MDX four-stem checkpoint (`0d19c1c6`) instead of Demucs' slower four-model `mdx` ensemble or the heavier default `htdemucs` model. It processes 5-second chunks, disables extra random inference shifts, and uses a lower chunk overlap to reduce memory and processing time. Using one checkpoint can slightly reduce separation quality compared with the ensemble. Demucs automatically uses CUDA when the installed PyTorch build and machine support it; otherwise it falls back to CPU. Long songs may still take a while on older CPU-only computers. For faster processing without changing models, use a CUDA-capable machine with a CUDA-enabled PyTorch installation.

## Setup on Windows

Open PowerShell and change to the project folder:

```powershell
cd C:\path\to\StemSeparator
```

Create and activate a virtual environment. If the project already has a `venv` folder, skip the creation command:

```powershell
py -3.11 -m venv venv
.\venv\Scripts\Activate.ps1
```

If PowerShell blocks script activation, either allow activation for the current PowerShell process or use the Command Prompt activation script:

```powershell
.\venv\Scripts\activate.bat
```

Install the pinned dependencies:

```powershell
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

The repository's `venv/` directory is ignored by Git and should not be committed.

## Run the application

From the project root, with the virtual environment activated, start the FastAPI development server:

```powershell
python -m uvicorn main:app --reload
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000) in a browser. Leave the terminal running while using the app. Press **Ctrl+C** in that terminal to stop the server.

`--reload` is convenient for local development. For a non-development run, omit it:

```powershell
python -m uvicorn main:app
```

## Use the web interface

1. Open the application at `http://127.0.0.1:8000`.
2. Click **Browse My Files** and select an MP3 or WAV file.
3. Wait for the status to change to **Separation Complete**. On the first run, Demucs may need to download its pretrained model before processing starts.
4. Play each generated stem in the page, or click **Download** to save its WAV file.

The progress bar indicates that separation is in progress; elapsed time is displayed because the model does not report a reliable completion percentage. The application checks the job status periodically.

## Processing flow

1. The page uploads the selected file to `POST /upload`.
2. The server stores the upload in `uploads/`, creates a job ID, and starts a background Demucs process.
3. The browser polls `GET /status/{job_id}` until processing completes or fails.
4. When complete, the page requests the four stem URLs from `GET /stems/{job_id}`.
5. Each stem can be streamed or downloaded from `GET /download/{job_id}/{stem}`.

Each job writes its own output under `separated/<job-id>/0d19c1c6/<uploaded-file-id>/`, containing `vocals.wav`, `drums.wav`, `bass.wav`, and `other.wav`. Each upload receives a unique server-side name so simultaneous uploads with the same original filename do not overwrite one another.

## Project structure

```text
StemSeparator/
├── main.py                 # FastAPI routes, uploads, jobs, and Demucs processing
├── requirements.txt        # Pinned Python dependencies
├── templates/
│   └── index.html          # Web page
├── static/
│   ├── css/style.css       # Page styling
│   └── js/script.js        # Upload, status polling, and stem playback/download
├── uploads/                # Uploaded audio (created automatically)
├── separated/              # Demucs output (created automatically)
└── venv/                   # Local Python environment (create during setup)
```

## API endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/` | Serve the web interface |
| `POST` | `/upload` | Upload audio and queue separation |
| `GET` | `/status/{job_id}` | Read the job status; returns `404` for an unknown job |
| `GET` | `/stems/{job_id}` | Get the four stem download URLs after completion |
| `GET` | `/download/{job_id}/{stem}` | Stream or download a stem WAV file |

Interactive API documentation is available at [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs) while the server is running.

## Notes and troubleshooting

- **`ModuleNotFoundError` when starting:** Activate the project virtual environment and install dependencies with `python -m pip install -r requirements.txt`.
- **`demucs` command not found:** Confirm that the venv is activated and that the requirements installation completed successfully.
- **Model download or network error:** Check the internet connection and retry. Demucs needs to fetch its pretrained model if it is not already cached.
- **Processing is slow:** Separation time depends on track length and hardware. The app uses one MDX checkpoint, 5-second chunks, faster inference settings, and automatically uses CUDA if available. CPU-only processing, particularly on older computers, can still take longer than the song itself. Keep the server running and the browser tab open until the four stems are ready.
- **“Server returned a non-JSON response” during processing:** The hosting service returned an HTML error page instead of the app's JSON status. Check the host's server logs for a restart, timeout, or memory limit during Demucs inference. Jobs are kept in memory, so if the server restarts you must upload the track again.
- **Job not found after restarting:** Job state is stored in memory, so restarting the server clears previously created jobs. Start a new upload.
- **Files use disk space:** Uploaded files and generated stems are written to `uploads/` and `separated/`; remove files you no longer need.

This is a local development application, not a production deployment. Job state is in memory, and the upload endpoint does not implement production authentication, size limits, or persistent job storage.
