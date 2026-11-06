#!/usr/bin/env python3
"""Build js/de-questions.js from the Data Engineer Professional PDF XML export."""

import html
import json
import os
import re
import shutil
from collections import Counter

XML_PATH = "/tmp/de.xml"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIG_DIR = os.path.join(ROOT, "assets", "de")
OUT_JS = os.path.join(ROOT, "js", "de-questions.js")

DOMAINS = {
    "processing": [
        "스트리밍", "streaming", "watermark", "autoloader", "auto loader", "delta live",
        "데이터프레임", "dataframe", "spark", "조인", "집계", "merge", "cdc", "변경 데이터",
        "vacuum", "optimize", "z-order", "zorder", "liquid clustering", "partition",
        "파이프라인", "sql", "윈도우", "window", "trigger", "checkpoint",
    ],
    "modeling": [
        "브론즈", "실버", "골드", "bronze", "silver", "gold", "메달리온", "medallion",
        "차원", "slowly changing", "scd", "제약 조건", "constraint", "primary key",
        "foreign key", "스키마", "모델링", "star schema", "데이터 모델", "기대치", "expectation",
    ],
    "governance": [
        "unity catalog", "유니티 카탈로그", "권한", "grant", "privilege", "마스킹", "mask",
        "행 필터", "row filter", "거버넌스", "보안", "암호화", "secret", "서비스 주체",
        "접근 제어", "acl", "동적 뷰", "lineage", "리니지", "감사",
    ],
    "platform": [
        "클러스터", "노트북", "웨어하우스", "sql warehouse", "photon", "런타임",
        "workspace", "워크스페이스", "repos", "리포지토리", "dbutils", "위젯",
    ],
    "reliability": [
        "모니터링", "알림", "alert", "로깅", "로그", "테스트", "배포", "ci/cd",
        "워크플로", "workflow", "잡", "job", "복구", "재시도", "retry", "실패",
        "프로덕션", "검증", "품질", "쿼런틴", "quarantine",
    ],
}


def classify(text):
    low = text.lower()
    scores = {}
    for domain, words in DOMAINS.items():
        scores[domain] = 0
        for word in words:
            if word.lower() in low:
                scores[domain] += 2 if " " in word else 1
    best = max(scores, key=lambda name: (scores[name], name == "processing"))
    if scores[best] == 0:
        return "processing"
    return best


def clean_line(text):
    text = html.unescape(text)
    text = text.replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def merge_text(blocks, line):
    if blocks and blocks[-1]["t"] == "text":
        prev = blocks[-1]["v"]
        if prev.endswith("-") and line[:1].isalnum():
            blocks[-1]["v"] = prev + line
        else:
            blocks[-1]["v"] = prev + " " + line
    else:
        blocks.append({"t": "text", "v": line})


def polish(text):
    text = re.sub(r"(\w)- (\w)", r"\1-\2", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def polish_blocks(blocks):
    out = []
    for block in blocks:
        if block["t"] == "text":
            value = polish(block["v"])
            if not value:
                continue
            if out and out[-1]["t"] == "text":
                out[-1]["v"] = polish(out[-1]["v"] + " " + value)
            else:
                out.append({"t": "text", "v": value})
        else:
            out.append(block)
    return out


def parse_pages(xml):
    pages = []
    for _num, body in re.findall(r'<page number="(\d+)"[^>]*>(.*?)</page>', xml, re.S):
        items = []
        for match in re.finditer(r"<image([^>]*)/>|<text([^>]*)>(.*?)</text>", body, re.S):
            if match.group(1) is not None:
                attrs = match.group(1)
                top = int(re.search(r'top="(\d+)"', attrs).group(1))
                left = int(re.search(r'left="(\d+)"', attrs).group(1))
                src = re.search(r'src="([^"]+)"', attrs).group(1)
                if top < 90 or top > 1180:
                    continue
                if not os.path.exists(src) or os.path.getsize(src) < 2000:
                    continue
                items.append({"top": top, "left": left, "kind": "img", "src": src})
            else:
                attrs, inner = match.group(2), match.group(3)
                top = int(re.search(r'top="(\d+)"', attrs).group(1))
                left = int(re.search(r'left="(\d+)"', attrs).group(1))
                if top < 90 or top > 1180:
                    continue
                text = clean_line(re.sub(r"<[^>]+>", "", inner))
                if not text or "IT Certification Guaranteed" in text:
                    continue
                if re.fullmatch(r"\d{1,3}", text) and left > 400:
                    continue
                items.append({"top": top, "left": left, "kind": "text", "text": text})
        items.sort(key=lambda item: (item["top"], 0 if item["kind"] == "img" else item["left"]))
        pages.append(items)
    return pages


def grab_answer(question, text):
    for letter in re.findall(r"[A-E]", text.upper()):
        if letter not in question["answer"]:
            question["answer"].append(letter)


def parse_questions(pages):
    questions = []
    current = None
    mode = None
    choice = None

    def start_question(qid, first_line):
        nonlocal current, mode, choice
        current = {"id": qid, "stem": [], "choices": [], "answer": [], "explanation": []}
        mode = "stem"
        choice = None
        if first_line:
            merge_text(current["stem"], first_line)

    def close():
        nonlocal current, mode, choice
        if current:
            questions.append(current)
        current = None
        mode = None
        choice = None

    for items in pages:
        for item in items:
            if item["kind"] == "img":
                if mode == "choice" and choice is not None:
                    choice["blocks"].append({"t": "img", "src": item["src"]})
                elif mode == "stem" and current is not None:
                    current["stem"].append({"t": "img", "src": item["src"]})
                continue
            text = item["text"]
            left = item["left"]
            qmatch = re.match(r"QUESTION NO:\s*(\d+)\b(.*)", text, re.I)
            if qmatch and left < 200:
                close()
                start_question(int(qmatch.group(1)), qmatch.group(2).strip())
                continue
            if current is None:
                continue
            if text.startswith("Answer"):
                mode = "answer"
                choice = None
                rest = text.split(":", 1)[-1].strip() if ":" in text else ""
                if rest:
                    grab_answer(current, rest)
                    if not re.fullmatch(r"[A-E](?:\s*,\s*[A-E])*\s*,?", rest):
                        mode = "explanation"
                continue
            if mode == "answer":
                compact = text.replace(" ", "").replace(",", "")
                if text.lower().startswith("explanation"):
                    mode = "explanation"
                    rest = re.sub(r"(?i)^explanation\s*:?", "", text).strip()
                    if rest:
                        merge_text(current["explanation"], rest)
                elif re.fullmatch(r"[A-E]{1,5}", compact) and len(text) <= 12:
                    grab_answer(current, text)
                else:
                    mode = "explanation"
                    merge_text(current["explanation"], text)
                continue
            if mode == "explanation":
                if text.lower().startswith("explanation"):
                    rest = re.sub(r"(?i)^explanation\s*:?", "", text).strip()
                    if rest:
                        merge_text(current["explanation"], rest)
                else:
                    merge_text(current["explanation"], text)
                continue
            if re.fullmatch(r"[A-E]\.", text) and left < 90:
                mode = "choice"
                choice = {"key": text[0], "blocks": []}
                current["choices"].append(choice)
                continue
            if mode == "choice" and choice is not None:
                merge_text(choice["blocks"], text)
            else:
                merge_text(current["stem"], text)
    close()
    return questions


def finalize(questions):
    os.makedirs(FIG_DIR, exist_ok=True)
    for old in os.listdir(FIG_DIR):
        path = os.path.join(FIG_DIR, old)
        if os.path.isfile(path):
            os.remove(path)
    used = {}
    finalized = []
    for question in questions:
        qid = question["id"]

        def place(blocks, qid=qid):
            placed = []
            for block in polish_blocks(blocks):
                if block["t"] == "img":
                    ext = os.path.splitext(block["src"])[1].lower() or ".jpg"
                    n = used.get(qid, 0) + 1
                    used[qid] = n
                    name = f"q{qid}-{n}{ext}"
                    shutil.copyfile(block["src"], os.path.join(FIG_DIR, name))
                    placed.append({"t": "img", "src": f"assets/de/{name}"})
                else:
                    placed.append(block)
            return placed

        stem = place(question["stem"])
        choices = [{"key": choice["key"], "blocks": place(choice["blocks"])} for choice in question["choices"]]
        explanation = " ".join(
            block["v"] for block in polish_blocks(question["explanation"]) if block["t"] == "text"
        ).strip()
        stem_text = " ".join(block["v"] for block in stem if block["t"] == "text")
        choice_text = " ".join(block["v"] for choice in choices for block in choice["blocks"] if block["t"] == "text")
        answer = list(question["answer"])
        multi = len(answer) > 1
        finalized.append({
            "id": qid,
            "domain": classify(stem_text + " " + choice_text),
            "stem": stem,
            "choices": choices,
            "answer": answer,
            "booklet": [],
            "note": "",
            "explanation": explanation,
            "multi": multi,
        })
    finalized.sort(key=lambda item: item["id"])
    return finalized


def main():
    xml = open(XML_PATH, encoding="utf-8", errors="replace").read()
    questions = finalize(parse_questions(parse_pages(xml)))
    payload = json.dumps(questions, ensure_ascii=False, separators=(",", ":"))
    with open(OUT_JS, "w", encoding="utf-8") as handle:
        handle.write("window.DE_QUESTION_BANK = ")
        handle.write(payload)
        handle.write(";\n")
    print("questions", len(questions))
    print("missing choices", [q["id"] for q in questions if len(q["choices"]) < 2])
    print("bad answer", [
        q["id"] for q in questions
        if not q["answer"] or any(letter not in {c["key"] for c in q["choices"]} for letter in q["answer"])
    ])
    print("empty choice", [f"{q['id']}{c['key']}" for q in questions for c in q["choices"] if not c["blocks"]])
    print("domains", Counter(q["domain"] for q in questions))
    print("images", sum(1 for q in questions if any(b["t"] == "img" for b in q["stem"]) or any(b["t"] == "img" for c in q["choices"] for b in c["blocks"])))
    print("multi", [(q["id"], "".join(q["answer"])) for q in questions if q["multi"]])


if __name__ == "__main__":
    main()
