#!/usr/bin/env python3
import json
import re
import sys
from typing import List

from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

MODEL_NAME = "google/pegasus-xsum"
tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_NAME)


def split_sentences(text: str) -> List[str]:
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    return [p.strip() for p in parts if p.strip()]


def generate_takeaways(summary: str, content: str) -> List[str]:
    items = split_sentences(summary)
    if len(items) >= 5:
        return items[:5]

    remaining = 5 - len(items)
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


def summarize(text: str) -> str:
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
    return tokenizer.decode(summary_ids[0], skip_special_tokens=True).strip()


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
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)
