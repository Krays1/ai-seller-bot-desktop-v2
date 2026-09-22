# Qwen3-TTS (MLX)

The Apple-Silicon-native counterpart to [Qwen3-TTS](server_qwen3TTS.md): the
same Qwen3-TTS Base checkpoint family, run through
[mlx-audio](https://github.com/Blaizzy/mlx-audio) instead of
`qwen_tts`/PyTorch. It exists for a controlled A/B comparison between the
stock PyTorch/MPS server and MLX on the same Mac, so it deliberately mirrors
`server_qwen3TTS.py`'s core request/response shape as closely as mlx-audio's
API allows.

Quick stats:

- **Server script**: [server_qwen3TTS_mlx.py](server_qwen3TTS_mlx.py)
- **Sample rate**: 24 kHz
- **Device**: reported as `mlx` (no device-selection env var -- mlx-audio has
  no such knob; MLX itself picks its compute backend, Metal on Apple Silicon)
- **Cloning mode**: ICL (in-context learning) only -- `reference_text` is
  **required**. There is no speaker-embedding-only fallback in this version.

## Differences from `server_qwen3TTS.py`

This is a first version focused on a tight, apples-to-apples comparison of
the two backends. It intentionally does **not** implement:

- `x_vector_only_mode` (speaker-embedding-only cloning) -- `reference_text`
  is required instead of optional.
- Long-text chunking beyond mlx-audio's own newline-based segmentation.
- Streaming (`stream=False` is hardcoded).
- Voice-library / preset-voice profiles.
- `speed`.
- OpenAI API compatibility.
- `temperature` / `top_p` / `repetition_penalty` -- inspection of the
  installed mlx-audio source (`mlx_audio/tts/models/qwen3_tts/qwen3_tts.py`)
  confirms `Model.generate()` does accept these, but they are left out of
  this first version to keep the request surface identical to the fields
  compared in the A/B test. They can be added later without touching the
  core comparison.

`seed` **is** exposed: MLX's global PRNG (`mx.random.seed()`) drives the
talker's token sampling (`mx.random.categorical` in mlx-audio's own sampling
code), so seeding is genuine and verified, not guessed.

## Installation

Start by setting up a venv (or use your conda setup):

```
mkdir Qwen3TTSMLX
cd Qwen3TTSMLX
python3 -m venv .venv
source .venv/bin/activate
```

Now install mlx-audio in this environment (requires Apple Silicon):

```
pip install -U mlx-audio
```

Now clone `tts-serve` and install its dependencies:

```
git clone https://github.com/scorbo2/tts-serve
cd tts-serve
pip install ./tts-engine-common fastapi uvicorn loguru soundfile
```

Start it up!

```
python impl/server_qwen3TTS_mlx.py
```

### Changing host

By default, `0.0.0.0` is used. To force a local-only server:

```
export QWEN3TTS_MLX_HOST=127.0.0.1
python impl/server_qwen3TTS_mlx.py
```

### Changing port

By default, the server uses port `7500`, matching the other Qwen3-TTS
implementation.

To choose a different port:

```bash
export QWEN3TTS_MLX_PORT=8600
python impl/server_qwen3TTS_mlx.py
```

### To use a different model

By default, the server downloads
`mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit` from HuggingFace on first run.
To use a different MLX-converted checkpoint or a local path:

```
export QWEN3TTS_MLX_MODEL=/path/to/model/
python impl/server_qwen3TTS_mlx.py
```
