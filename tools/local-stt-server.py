import io
import os
import threading
import traceback

import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse
from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline

HOST = "127.0.0.1"
PORT = 9000
# Prefer HF model id (downloads/caches for this Windows user). Override with STT_MODEL_ID.
MODEL_ID = os.environ.get(
    "STT_MODEL_ID",
    "openai/whisper-large-v3-turbo",
)
HF_HOME = os.path.expanduser("~/.cache/huggingface/hub")

app = FastAPI(title="Zello Bot Local STT", version="1.0")

_lock = threading.Lock()
_pipe = None
_load_error = None
_device_name = None


def build_pipeline():
    global _pipe, _load_error, _device_name

    try:
        if torch.cuda.is_available():
            device = "cuda:0"
            torch_dtype = torch.float16
            _device_name = torch.cuda.get_device_name(0)
        else:
            device = "cpu"
            torch_dtype = torch.float32
            _device_name = "CPU"

        local_only = os.path.isdir(MODEL_ID)
        model = AutoModelForSpeechSeq2Seq.from_pretrained(
            MODEL_ID,
            torch_dtype=torch_dtype,
            low_cpu_mem_usage=True,
            use_safetensors=True,
            local_files_only=local_only,
            cache_dir=HF_HOME
        )

        model.to(device)

        processor = AutoProcessor.from_pretrained(
            MODEL_ID,
            local_files_only=local_only,
            cache_dir=HF_HOME
        )

        _pipe = pipeline(
            "automatic-speech-recognition",
            model=model,
            tokenizer=processor.tokenizer,
            feature_extractor=processor.feature_extractor,
            torch_dtype=torch_dtype,
            device=device
        )

        _load_error = None

    except Exception as exc:
        _pipe = None
        _load_error = f"{type(exc).__name__}: {exc}"
        traceback.print_exc()


def ensure_pipeline():
    if _pipe is not None:
        return _pipe

    if _load_error:
        raise RuntimeError(_load_error)

    with _lock:
        if _pipe is None and not _load_error:
            build_pipeline()

    if _pipe is None:
        raise RuntimeError(_load_error or "Whisper pipeline failed to initialize.")

    return _pipe


def decode_audio(data: bytes):
    audio, sample_rate = sf.read(
        io.BytesIO(data),
        dtype="float32",
        always_2d=False
    )

    if isinstance(audio, np.ndarray) and audio.ndim > 1:
        audio = np.mean(audio, axis=1)

    audio = np.asarray(audio, dtype=np.float32)

    if sample_rate <= 0:
        raise ValueError("Invalid audio sample rate.")

    if audio.size == 0:
        raise ValueError("Audio file is empty.")

    return audio, int(sample_rate)


@app.get("/health")
def health():
    return {
        "ready": _pipe is not None,
        "loading": _pipe is None and _load_error is None,
        "model": MODEL_ID,
        "device": _device_name,
        "cuda": torch.cuda.is_available(),
        "error": _load_error
    }


@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    model: str = Form("whisper-1"),
    response_format: str = Form("json"),
    language: str = Form("en")
):
    try:
        raw = await file.read()
        audio, sample_rate = decode_audio(raw)

        duration = float(audio.shape[0]) / float(sample_rate)

        if duration < 0.15:
            return {"text": ""}

        pipe = ensure_pipeline()

        request = {
            "array": audio,
            "sampling_rate": sample_rate
        }

        kwargs = {
            "generate_kwargs": {
                "task": "transcribe"
            }
        }

        if language:
            kwargs["generate_kwargs"]["language"] = language

        if duration > 28:
            kwargs["chunk_length_s"] = 30
            kwargs["stride_length_s"] = 5

        with _lock:
            result = pipe(request, **kwargs)

        if isinstance(result, dict):
            text = str(result.get("text", "")).strip()
        else:
            text = str(result).strip()

        return {"text": text}

    except Exception as exc:
        traceback.print_exc()

        return JSONResponse(
            status_code=500,
            content={
                "error": f"{type(exc).__name__}: {exc}"
            }
        )


@app.on_event("startup")
def startup():
    threading.Thread(
        target=build_pipeline,
        daemon=True
    ).start()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=HOST,
        port=PORT,
        log_level="info"
    )
