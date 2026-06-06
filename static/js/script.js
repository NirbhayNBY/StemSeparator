let currentJob = "";
let progress = 0;
let progressTimer = null;

const fileInput = document.getElementById("songFile");

fileInput.addEventListener("change", () => {
    if (fileInput.files.length > 0) {
        uploadSong();
    }
});

async function uploadSong() {

    const file = fileInput.files[0];

    if (!file) {
        alert("Select a file first");
        return;
    }

    document.getElementById("status").innerText =
        "Uploading audio...";

    document.getElementById("results").innerHTML = "";

    progress = 0;
    updateProgress(0);

    const formData = new FormData();
    formData.append("file", file);

    try {

        const response = await fetch("/upload", {
            method: "POST",
            body: formData
        });

        const data = await response.json();

        currentJob = data.job_id;

        startFakeProgress();

        checkStatus();

    } catch (err) {

        document.getElementById("status").innerText =
            "Upload Failed";

        console.error(err);
    }
}

function startFakeProgress() {

    clearInterval(progressTimer);

    progressTimer = setInterval(() => {

        if (progress < 90) {
            progress += 2;
            updateProgress(progress);
        }

    }, 1500);
}

function updateProgress(value) {

    document.getElementById("progressBar").style.width =
        value + "%";
}

async function checkStatus() {

    const poller = setInterval(async () => {

        try {

            const response =
                await fetch(`/status/${currentJob}`);

            const data =
                await response.json();

            document.getElementById("status").innerText =
                `Status: ${data.status}`;

            if (data.status === "completed") {

                clearInterval(poller);
                clearInterval(progressTimer);

                updateProgress(100);

                document.getElementById("status").innerText =
                    "Separation Complete";

                loadStems();
            }

            if (data.status === "failed") {

                clearInterval(poller);
                clearInterval(progressTimer);

                document.getElementById("status").innerText =
                    "Processing Failed";
            }

        } catch (err) {

            console.error(err);
        }

    }, 3000);
}

async function loadStems() {

    const response =
        await fetch(`/stems/${currentJob}`);

    const stems =
        await response.json();

    document.getElementById("results").innerHTML = `

        ${createStemCard("Vocals", stems.vocals)}

        ${createStemCard("Drums", stems.drums)}

        ${createStemCard("Bass", stems.bass)}

        ${createStemCard("Other", stems.other)}

    `;
}

function createStemCard(title, url) {

    return `
        <div class="result-card">

            <h3>${title}</h3>

            <audio controls>
                <source src="${url}" type="audio/wav">
            </audio>

            <br>

            <a
                class="download-btn"
                href="${url}"
                download
            >
                Download
            </a>

        </div>
    `;
}