"""Minimal ``mlx.core`` stub for machines without Apple's MLX installed.

Only the tiny API surface ``server_qwen3TTS_mlx.py`` touches at import time
(and in the request paths covered by the tests) is provided.  Real generation
is never exercised in the test suite (the fake_runtime fixture bypasses model
loading), so ``array``/``eval`` are inert placeholders and ``random.seed`` is
a no-op.

The real MLX always wins when installed (this stub is appended to
``sys.path`` last by conftest) -- but even then, the test suite must never
load a real model (see AGENTS.md); the fake_runtime fixture is what actually
guarantees that, not this stub.
"""


class array:
    """Placeholder so ``mx.array(...)`` is callable; never inspected in tests."""

    def __init__(self, *args, **kwargs) -> None:
        pass


def eval(*args, **kwargs) -> None:
    pass


def clear_cache() -> None:
    pass


class _Random:
    @staticmethod
    def seed(seed: int) -> None:
        pass


random = _Random()
