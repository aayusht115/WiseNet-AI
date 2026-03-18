#!/usr/bin/env python3
import json
import os
import re
import sys
import warnings
from typing import List, Optional, Tuple

os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")

warnings.filterwarnings("ignore", message=".*NotOpenSSLWarning.*")

try:
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
    from transformers.utils import logging as hf_logging

    hf_logging.set_verbosity_error()
except Exception:
    AutoModelForSeq2SeqLM = None  # type: ignore
    AutoTokenizer = None  # type: ignore

MODEL_NAME = "google/pegasus-xsum"
_TOKENIZER = None
_MODEL = None


def split_sentences(text: str) -> List[str]:
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    return [p.strip() for p in parts if p.strip()]


def fallback_summary(text: str, max_sentences: int = 3, max_chars: int = 700) -> str:
    sentences = split_sentences(text)
    if not sentences:
        return text.strip()[:max_chars]
    summary = " ".join(sentences[:max_sentences]).strip()
    return summary[:max_chars]


def token_overlap_ratio(a: str, b: str) -> float:
    tokens_a = {t.lower() for t in re.findall(r"[A-Za-z]{4,}", a)}
    tokens_b = {t.lower() for t in re.findall(r"[A-Za-z]{4,}", b)}
    if not tokens_a or not tokens_b:
        return 0.0
    return len(tokens_a & tokens_b) / max(1, len(tokens_a))


def generate_takeaways(summary: str, content: str) -> List[str]:
    items = split_sentences(summary)
    if len(items) >= 5:
        return items[:5]

    extra = split_sentences(content)
    for sentence in extra:
        if len(sentence) < 30:
            continue
        if sentence in items:
            continue
        items.append(sentence)
        if len(items) >= 5:
            break

    if not items:
        return ["No key takeaways could be generated."]
    return items[:5]


def generate_further_reading(title: str) -> List[str]:
    clean_title = title.strip() or "the topic"
    return [
        f"Read a foundational textbook chapter on {clean_title}.",
        f"Find one case study that applies {clean_title} in practice.",
        f"Review one recent research article related to {clean_title}.",
    ]


def load_model() -> Tuple[Optional[object], Optional[object]]:
    global _TOKENIZER, _MODEL

    if _TOKENIZER is not None and _MODEL is not None:
        return _TOKENIZER, _MODEL

    if AutoTokenizer is None or AutoModelForSeq2SeqLM is None:
        return None, None

    try:
        _TOKENIZER = AutoTokenizer.from_pretrained(MODEL_NAME, local_files_only=True)
        _MODEL = AutoModelForSeq2SeqLM.from_pretrained(MODEL_NAME, local_files_only=True)
        return _TOKENIZER, _MODEL
    except Exception:
        return None, None


def summarize(text: str) -> str:
    tokenizer, model = load_model()
    if tokenizer is None or model is None:
        return fallback_summary(text)

    try:
        encoded = tokenizer(
            text,
            truncation=True,
            max_length=1024,
            return_tensors="pt",
        )
        summary_ids = model.generate(
            **encoded,
            max_new_tokens=96,
            min_new_tokens=25,
            num_beams=4,
            length_penalty=0.8,
            early_stopping=True,
        )
        generated = tokenizer.decode(summary_ids[0], skip_special_tokens=True).strip()
        if not generated:
            return fallback_summary(text)
        if token_overlap_ratio(generated, text) < 0.08:
            return fallback_summary(text)
        return generated
    except Exception:
        return fallback_summary(text)


def main() -> None:
    raw = sys.stdin.read()
    payload = json.loads(raw) if raw.strip() else {}
    title = str(payload.get("title", "Untitled Reading"))
    content = str(payload.get("content", "")).strip()

    if not content:
        print(
            json.dumps(
                {
                    "title": title,
                    "summary": "",
                    "keyTakeaways": [],
                    "furtherReading": [],
                }
            )
        )
        return

    summary = summarize(content)
    response = {
        "title": title,
        "summary": summary,
        "keyTakeaways": generate_takeaways(summary, content),
        "furtherReading": generate_further_reading(title),
    }
    print(json.dumps(response))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Never fail hard: keep API response usable even if the model/runtime is unavailable.
        print(
            json.dumps(
                {
                    "title": "Untitled Reading",
                    "summary": "",
                    "keyTakeaways": [f"Summarizer fallback triggered: {exc}"],
                    "furtherReading": [],
                }
            )
        )
