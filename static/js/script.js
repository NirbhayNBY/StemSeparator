const fileInput = document.getElementById("songFile");
const dropZone = document.getElementById("dropZone");
const selectedFile = document.getElementById("selectedFile");
const processingPanel = document.getElementById("processingPanel");
const resultsSection = document.getElementById("resultsSection");
const changeFileButton = document.getElementById("changeFile");
const themeToggle = document.getElementById("themeToggle");
const root = document.documentElement;
const progressBar = document.getElementById("progressBar");
const progressTrack = document.querySelector(".progress-track");
const statusIndicator = document.getElementById("statusIndicator");

const stems = [
    { key: "vocals", label: "Vocals", color: "#c6f276" },
    { key: "drums", label: "Drums", color: "#f1a970" },
    { key: "bass", label: "Bass", color: "#8cb7ff" },
    { key: "other", label: "Instruments", color: "#c49bff" },
];

let currentJob = "";
let progress = 0;
let progressTimer = null;
let statusTimer = null;
let statusFailures = 0;

const savedTheme = localStorage.getItem("stemseparator-theme");
const initialTheme = savedTheme || (
    window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"
);
setTheme(initialTheme);

themeToggle.addEventListener("click", () => {
    const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    localStorage.setItem("stemseparator-theme", nextTheme);
});

function setTheme(theme) {
    root.dataset.theme = theme;
    const nextTheme = theme === "dark" ? "light" : "dark";
    themeToggle.setAttribute("aria-label", `Switch to ${nextTheme} theme`);
    themeToggle.title = `Switch to ${nextTheme} theme`;
}

fileInput.addEventListener("change", () => {
    const [file] = fileInput.files;
    if (file) {
        fileInput.value = "";
        uploadSong(file);
    }
});

changeFileButton.addEventListener("click", () => {
    fileInput.value = "";
    fileInput.click();
});

dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        fileInput.click();
    }
});

["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropZone.classList.add("is-dragging");
    });
});

["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropZone.classList.remove("is-dragging");
    });
});

dropZone.addEventListener("drop", (event) => {
    const [file] = event.dataTransfer.files;
    if (file) {
        uploadSong(file);
    }
});

async function uploadSong(file) {
    if (!/\.(mp3|wav)$/i.test(file.name)) {
        showProcessingPanel();
        setStatus("Choose an MP3 or WAV audio file.", "error");
        document.getElementById("progressNote").textContent = "";
        return;
    }

    clearTimers();
    currentJob = "";
    statusFailures = 0;
    resultsSection.hidden = true;
    document.getElementById("results").replaceChildren();
    document.getElementById("fileName").textContent = file.name;
    document.getElementById("fileSize").textContent = formatFileSize(file.size);
    dropZone.hidden = true;
    selectedFile.hidden = false;
    showProcessingPanel();
    setStatus("Uploading your audio…", "active");
    document.getElementById("progressNote").textContent = "";
    updateProgress(0);

    const formData = new FormData();
    formData.append("file", file);

    try {
        const response = await fetch("/upload", {
            method: "POST",
            body: formData,
        });
        const data = await readApiResponse(response);
        if (!data.job_id) {
            throw new Error("The server did not return a separation job ID.");
        }

        currentJob = data.job_id;
        setStatus("Preparing your audio…", "active");
        document.getElementById("progressNote").textContent =
            "Progress is approximate. Longer tracks take more time to separate.";
        startApproximateProgress();
        await checkStatus();
    } catch (error) {
        setStatus(error.message || "Upload failed. Please try again.", "error");
        document.getElementById("progressNote").textContent =
            "Check that the server is running, then choose a file to retry.";
        console.error("Audio upload failed:", error);
    }
}

function showProcessingPanel() {
    processingPanel.hidden = false;
}

function setStatus(message, state) {
    document.getElementById("status").textContent = message;
    statusIndicator.classList.toggle("is-active", state === "active");
    statusIndicator.classList.toggle("is-error", state === "error");
}

function startApproximateProgress() {
    clearInterval(progressTimer);
    progressTimer = setInterval(() => {
        if (progress < 90) {
            updateProgress(Math.min(progress + 2, 90));
        }
    }, 1500);
}

function updateProgress(value) {
    progress = value;
    progressBar.style.width = `${value}%`;
    progressTrack.setAttribute("aria-valuenow", String(value));
    document.getElementById("progressValue").textContent =
        value > 0 && value < 100 ? `${value}%` : "";
}

async function checkStatus() {
    if (!currentJob) {
        return;
    }

    try {
        const response = await fetch(`/status/${encodeURIComponent(currentJob)}`);
        const data = await readApiResponse(response);
        statusFailures = 0;

        if (data.status === "completed") {
            clearTimers();
            updateProgress(100);
            setStatus("Your stems are ready.", "complete");
            document.getElementById("progressNote").textContent = "";
            await loadStems();
            return;
        }

        if (data.status === "failed") {
            clearTimers();
            setStatus("Separation failed.", "error");
            document.getElementById("progressNote").textContent =
                data.error || "Please try another audio file.";
            return;
        }

        const labels = {
            queued: "Waiting to process…",
            processing: "Separating your audio…",
        };
        setStatus(labels[data.status] || "Preparing your audio…", "active");
        statusTimer = setTimeout(checkStatus, 2000);
    } catch (error) {
        console.error("Could not check separation status:", error);
        if (error.retryable === false || ++statusFailures >= 5) {
            clearTimers();
            setStatus("Could not check the separation status.", "error");
            document.getElementById("progressNote").textContent =
                `${error.message} Check the server or hosting logs. Choose the file again to retry.`;
            return;
        }
        setStatus("Connection interrupted. Retrying…", "active");
        document.getElementById("progressNote").textContent = error.message;
        statusTimer = setTimeout(checkStatus, 4000);
    }
}

async function loadStems() {
    try {
        const response = await fetch(`/stems/${encodeURIComponent(currentJob)}`);
        const data = await readApiResponse(response);

        const results = document.getElementById("results");
        results.replaceChildren(...stems.map((stem, index) =>
            createStemCard(stem, data[stem.key], index + 1)
        ));
        resultsSection.hidden = false;
    } catch (error) {
        setStatus("Stems were processed, but could not be loaded.", "error");
        document.getElementById("progressNote").textContent = error.message;
        console.error("Could not load separated stems:", error);
    }
}

function createStemCard(stem, url, index) {
    const card = document.createElement("article");
    card.className = "result-card";
    card.style.setProperty("--stem-color", stem.color);

    const heading = document.createElement("div");
    heading.className = "result-card-heading";

    const dot = document.createElement("span");
    dot.className = "stem-dot";
    dot.setAttribute("aria-hidden", "true");

    const title = document.createElement("h3");
    title.textContent = stem.label;

    const number = document.createElement("span");
    number.className = "stem-number";
    number.textContent = String(index).padStart(2, "0");

    heading.append(dot, title, number);

    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "none";
    audio.setAttribute("aria-label", `Preview ${stem.label}`);

    const source = document.createElement("source");
    source.src = url;
    source.type = "audio/wav";
    audio.append(source);

    const download = document.createElement("a");
    download.className = "download-btn";
    download.href = url;
    download.download = `${stem.key}.wav`;
    download.innerHTML = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M4 13.5v2A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5v-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Download WAV';

    card.append(heading, audio, download);
    return card;
}

async function readApiResponse(response) {
    const body = await response.text();
    let data;

    try {
        data = JSON.parse(body);
    } catch {
        const error = new Error(
            `The server returned a non-JSON response (HTTP ${response.status}). ` +
            "The app may have restarted or the hosting service may have stopped the request."
        );
        error.retryable = response.status >= 500;
        throw error;
    }

    if (!data || typeof data !== "object") {
        const error = new Error("The server returned an invalid JSON response.");
        error.retryable = response.status >= 500;
        throw error;
    }

    if (!response.ok || data.error) {
        const error = new Error(
            data.detail || data.error || `Request failed (HTTP ${response.status}).`
        );
        error.retryable = response.status >= 500;
        throw error;
    }

    return data;
}

function formatFileSize(bytes) {
    if (bytes < 1024 * 1024) {
        return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function clearTimers() {
    clearInterval(progressTimer);
    clearTimeout(statusTimer);
    progressTimer = null;
    statusTimer = null;
}
