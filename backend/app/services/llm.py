"""
Local language model wrapper for Diagnostix CDSS.

Idea adapted from AdarshBP/LLM-Drug-Interaction-Checker (Hugging Face
transformers, run locally). Rewritten from scratch: it uses an
instruction-tuned chat model instead of GPT-2, greedy decoding for
reproducible output, background loading so the web app starts instantly,
and a lock so only one generation runs at a time.

Environment variables
  DX_LLM    hf (default) | stub | off
            hf   = load a Hugging Face model with transformers
            stub = canned answers, no download (tests / demos without a model)
            off  = AI disabled; the app uses knowledge-base text only
  DX_MODEL  Hugging Face model id (default Qwen/Qwen2.5-1.5B-Instruct)
            Low-RAM laptops: Qwen/Qwen2.5-0.5B-Instruct
  DX_DTYPE  auto (default) | float32 | bfloat16 | float16
"""
from __future__ import annotations

import logging
import os
import threading
import time

log = logging.getLogger("dx.llm")

DEFAULT_MODEL = "Qwen/Qwen2.5-1.5B-Instruct"


class LocalLLM:
    def __init__(self) -> None:
        self.mode = os.environ.get("DX_LLM", "hf").strip().lower()
        self.model_id = os.environ.get("DX_MODEL", DEFAULT_MODEL).strip()
        self.dtype_name = os.environ.get("DX_DTYPE", "auto").strip().lower()
        self.state = "idle"  # idle | loading | ready | error | disabled
        self.error: str | None = None
        self.device = "cpu"
        self.load_seconds: float | None = None
        self._lock = threading.Lock()
        self._tok = None
        self._model = None
        self._torch = None

    # ------------------------------------------------------------------ status
    def info(self) -> dict:
        return {
            "state": self.state,
            "mode": self.mode,
            "model": "stub" if self.mode == "stub" else self.model_id,
            "device": self.device,
            "dtype": self.dtype_name,
            "error": self.error,
            "load_seconds": self.load_seconds,
        }

    @property
    def ready(self) -> bool:
        return self.state == "ready"

    # ----------------------------------------------------------------- loading
    def start(self) -> None:
        if self.mode == "off":
            self.state = "disabled"
            return
        if self.mode == "stub":
            self.state = "ready"
            return
        if self.mode != "hf":
            self.state, self.error = "error", f"Unknown DX_LLM mode '{self.mode}'"
            return
        self.state = "loading"
        threading.Thread(target=self._load, name="dx-model-loader", daemon=True).start()

    def _pick_dtype(self, torch):
        names = {"float32": torch.float32, "bfloat16": torch.bfloat16, "float16": torch.float16}
        if self.dtype_name in names:
            return names[self.dtype_name]
        if torch.cuda.is_available():
            self.dtype_name = "float16"
            return torch.float16
        # CPU: float32 is fastest but needs ~4 bytes per parameter.
        # Fall back to bfloat16 (half the RAM, slower on older CPUs) below ~14 GB.
        try:
            import psutil

            total_gb = psutil.virtual_memory().total / 1e9
        except Exception:  # psutil missing or unsupported platform
            total_gb = 0
        if total_gb >= 14:
            self.dtype_name = "float32"
            return torch.float32
        self.dtype_name = "bfloat16"
        return torch.bfloat16

    def _load(self) -> None:
        t0 = time.time()
        try:
            import torch
            from transformers import AutoModelForCausalLM, AutoTokenizer

            dtype = self._pick_dtype(torch)
            log.info("Loading %s (%s) — first run downloads the weights…", self.model_id, self.dtype_name)
            tok = AutoTokenizer.from_pretrained(self.model_id)
            model = AutoModelForCausalLM.from_pretrained(self.model_id, torch_dtype=dtype)
            if torch.cuda.is_available():
                model.to("cuda")
                self.device = "cuda"
            model.eval()
            self._tok, self._model, self._torch = tok, model, torch
            self.load_seconds = round(time.time() - t0, 1)
            self.state = "ready"
            log.info("Model ready on %s in %.1f s", self.device, self.load_seconds)
        except Exception as exc:  # surface the reason in /api/health
            self.state = "error"
            self.error = f"{type(exc).__name__}: {exc}"
            log.exception("Model failed to load")

    # -------------------------------------------------------------- generation
    def generate(self, system: str, user: str, max_new_tokens: int = 220) -> str:
        if not self.ready:
            raise RuntimeError(f"Model not ready (state: {self.state})")
        if self.mode == "stub":
            return _stub_answer(system, user)

        with self._lock:
            messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
            prompt = self._tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
            inputs = self._tok(prompt, return_tensors="pt").to(self._model.device)
            with self._torch.no_grad():
                output = self._model.generate(
                    **inputs,
                    max_new_tokens=max_new_tokens,
                    do_sample=False,  # greedy: same input, same output
                    repetition_penalty=1.05,
                    pad_token_id=self._tok.eos_token_id,
                )
            new_tokens = output[0][inputs["input_ids"].shape[1]:]
            return self._tok.decode(new_tokens, skip_special_tokens=True).strip()


def _stub_answer(system: str, user: str) -> str:
    """Predictable output for tests: echoes knowledge-base facts, never invents."""
    if "SCREEN" in system:
        focus = ""
        for line in user.splitlines():
            if line.startswith("Focus on"):
                focus = line.split(":", 1)[1].strip()
        names = [n.strip() for n in focus.split(",") if n.strip()]
        return "\n".join(f"{n} — Unrecognised by the stub model — verify with a pharmacist" for n in names) or (
            "No clinically significant interactions identified."
        )
    for line in user.splitlines():
        if line.startswith("KNOWLEDGE BASE RATIONALE:"):
            text = line.split(":", 1)[1].strip()
            sentences = text.split(". ")
            return ". ".join(sentences[:2]).rstrip(".") + "."
    return "No rationale available."
