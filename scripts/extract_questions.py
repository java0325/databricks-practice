#!/usr/bin/env python3
"""Build js/questions.js and assets/fig from the exam PDF XML export."""

import html
import json
import os
import re
import shutil

XML_PATH = "/tmp/dbml.xml"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIG_DIR = os.path.join(ROOT, "assets", "fig")
OUT_JS = os.path.join(ROOT, "js", "questions.js")

# Booklet answers that contradict Databricks docs or later items in the same file.
# Scoring uses the corrected key. The printed key is kept for comparison.
CORRECTIONS = {
    1: ("C", "RMSE는 숫자 지표이므로 mlflow.log_metric으로 기록합니다. log_artifact는 파일용입니다."),
    2: ("A", "Shapley 설명을 계산하고 기록하는 API는 mlflow.shap.log_explanation입니다."),
    6: ("B", "연속적으로 같은 크기 마이크로배치를 만드는 도구는 Structured Streaming입니다."),
    8: ("D", "트리 개수처럼 실행마다 직접 정하는 값은 파라미터가므로 mlflow.log_param을 씁니다."),
    10: ("A", "Feature Store 테이블을 생성하면서 features_df의 데이터까지 적재하려면 fs.create_table에 df=features_df를 전달합니다. function은 create_table의 매개변수가 아닙니다."),
    11: ("B", "시그니처의 목적은 서빙 시 입력 스키마를 검증하는 것입니다. 입력을 자동 변환하지는 않습니다."),
    12: ("D", "Spark 스트리밍 배포는 트리거가 발생할 때마다 증분 레코드에 대해 추론합니다."),
    13: ("E", "MLflow Model Serving에서는 버전 번호 없이 https://<databricks-instance>/model/<모델명>/Production/invocations 주소로 Production 모델을 호출할 수 있습니다."),
    14: ("D", "애플리케이션과 라이브러리를 함께 패키징하는 도구는 컨테이너입니다."),
    15: ("E", "sklearn 객체로 다시 읽으려면 mlflow.sklearn.load_model을 사용합니다. pyfunc는 공통 래퍼입니다."),
    16: ("D", "로그한 그림은 해당 Run 페이지의 Artifacts에 있습니다. Figures라는 섹션은 없습니다."),
    17: ("B", "scikit-learn 모델을 기록하는 API는 mlflow.sklearn.log_model입니다."),
    18: ("D", "Model flavor는 배포 도구가 모델을 이해하도록 하는 규약입니다."),
    19: ("E", "ML 파이프라인 CI에서 자동 테스트를 흔히 깨우는 이벤트는 레지스트리에 새 모델 버전이 등록되는 일입니다."),
    21: ("E", "피처가 미리 준비된 경우, 배치로 저장해 둔 예측을 조회하는 편이 요청 시점에 계산하는 것보다 빠릅니다."),
    22: ("E", "기록된 MLflow 모델을 Spark DataFrame 배치 추론용 UDF로 불러오려면 mlflow.pyfunc.spark_udf(spark, f'runs:/{run_id}/random_forest_model')을 씁니다."),
    23: ("E", "PythonModel.predict의 context는 전처리 모델이나 설정 파일 같은 아티팩트에 접근할 때 씁니다."),
    26: ("C", "Delta 스트림 소스를 읽으려면 spark.read를 spark.readStream으로 바꿉니다."),
    28: ("B", "Production으로 전이하려면 client.transition_model_version_stage(name=model, version=model_version, stage='Production')을 호출합니다. 보기 B와 C의 그림이 같아 둘 다 정답으로 인정합니다."),
    29: ("A", "기존 등록 모델에 새 버전을 추가하는 연산은 mlflow.register_model입니다."),
    30: ("C", "pyfunc의 장점은 원래 학습 라이브러리에 묶이지 않고 같은 방식으로 배포할 수 있다는 점입니다."),
    35: ("A", "MODEL_VERSION_TRANSITIONED_TO_STAGING 웹훅을 깨우려면 client.transition_model_version_stage(name=model, version=model_version, stage='Staging')을 호출합니다. 보기 A와 E의 그림이 같아 둘 다 정답으로 인정합니다."),
    36: ("C", "컨셉 드리프트는 입력과 타깃의 관계가 바뀔 때입니다. 예측값 분포 변화는 prediction drift입니다."),
    38: ("A", "자식 실행을 부모 실행 아래에 두려면 자식 with mlflow.start_run(..., nested=True): 블록을 부모 with 블록 안으로 들여씁니다."),
    39: ("D", "실행 블록 안에서 CSV 파일을 아티팩트로 기록하는 함수는 mlflow.log_artifact(importance_path, 'feature-importance.csv')입니다."),
    42: ("A", "경로에 있는 Delta 테이블은 spark.read.format('delta').load(path)로 읽습니다."),
    43: ("E", "Feature Store 테이블을 Spark DataFrame으로 읽는 메서드는 fs.read_table입니다."),
    44: ("E", "컨셉 드리프트 감시는 예측값과 실제 레이블을 모은 뒤(1·2단계), 두 값으로 평가 지표를 계산하고(3단계), 시간에 따른 변화를 검정합니다(4단계)."),
    46: ("E", "Databricks에서 실험(exp_id)의 실행 데이터를 Spark DataFrame으로 읽으려면 spark.read.format('mlflow-experiment').load(exp_id)를 사용합니다."),
    47: ("E", "스테이지 전이 시 Slack 채널 같은 외부 주소로 알림을 보내려면 HTTP Webhook이 필요합니다. Databricks 작업 실행은 Job Webhook으로 처리합니다."),
    48: ("C", "전처리를 predict 안에 넣으면, 로드한 pyfunc를 호출할 때 같은 전처리가 다시 적용됩니다."),
    50: ("D", "기존 Production 버전을 아카이브하며 전이하려면 client.transition_model_version_stage(..., stage='Production', archive_existing_versions=True)를 사용합니다."),
    52: ("D", "모든 스테이지 전이를 받으려면 MODEL_VERSION_TRANSITIONED_STAGE 이벤트를 사용합니다."),
    55: ("C", "드리프트에 대한 대응으로는 재학습, 레이블을 바꾼 재구성, 서비스 종료가 모두 가능합니다."),
    56: ("D", "기존 Feature Store 테이블의 데이터를 새 DataFrame으로 모두 덮어쓰려면 fs.write_table(name='features', df=features_df, mode='overwrite')를 사용합니다."),
    58: ("E", "레이블 드리프트는 타깃 변수의 분포가 변하는 것입니다. 입력 분포 변화는 피처 드리프트입니다."),
    59: ("D", "운영 ML 프로젝트에서 가장 흔한 배포 방식은 배치입니다."),
    60: ("E", "라이브러리에 상관없이 오토로깅을 켜는 호출은 mlflow.autolog()입니다."),
    72: ("B", "Delta 버전은 0부터 시작합니다. 최초 버전은 option('versionAsOf', 0)입니다."),
    89: ("C", "애플리케이션과 라이브러리를 함께 패키징하는 도구는 컨테이너입니다."),
    95: ("A", "Unity Catalog에 등록하는 모든 모델에는 시그니처가 있어야 합니다. ML 작업은 전용(Dedicated) 액세스 모드 클러스터에서 지원됩니다."),
    129: ("A", "fs.score_batch(model_uri, spark_df)에 넘긴 DataFrame에 이미 피처 컬럼(spend)이 있으면 그 값으로 저장된 피처를 덮어써 추론합니다. get_updated_features 메서드는 없습니다."),
    132: ("D", "등록된 scikit-learn 모델을 Spark에서 병렬 추론용 UDF로 만들 때는 mlflow.pyfunc.spark_udf(보기 D의 mlflow.pyfunc.spark.udf)를 씁니다. mlflow.sklearn에는 spark_udf가 없습니다."),
}

EQUIV_ANSWERS = {
    28: ["B", "C"],
    35: ["A", "E"],
}

STRONG = {
    "monitoring": [
        "drift", "kolmogorov", "chi-squared", "chi squared", "jensen", "jenson",
        "wasserstein", "kullback", "lakehouse monitoring", "inference profile",
        "snapshot profile", "time series profile", "fairness", "demographic parity",
        "summary statistic", "contingency", "ks_test", "tv_distance",
    ],
    "deployment": [
        "model serving", "endpoint", "real-time", "blue-green", "canary", "shadow",
        "docker", "container", "online table", "streaming", "batch deployment",
        "batch inference", "edge/on-device", "on-device", "structured streaming",
        "score_batch", "invocation", "workload", "kafka", "microbatch",
        "applyinpandas", "pandas udf", "latency", "rest api", "always-on",
    ],
    "lifecycle": [
        "model registry", "webhook", "unity catalog", "asset bundle", "ci/cd",
        "integration test", "unit test", "terraform", "governance", "lineage",
        "transition", "registered_model", "staging", "archived", "deploy code",
        "jobs api", "blue green",
    ],
    "experimentation": [
        "mlflow", "autolog", "hyperopt", "optuna", "ray tune", "crossvalidator",
        "evaluator", "pipeline", "log_metric", "log_param", "log_model",
        "feature store", "featurelookup", "feature function", "delta",
        "hyperparameter", "signature", "pyfunc", "flavor", "spark ml",
        "trainvalidationsplit", "minmax", "random forest",
    ],
}

OVERRIDES = {
    20: "experimentation",  # Z-ordering is table layout, used while preparing data
    42: "experimentation",
    57: "experimentation",
    72: "experimentation",
    116: "experimentation",
    148: "deployment",
    174: "experimentation",
    175: "experimentation",
    4: "deployment",
    25: "deployment",
    61: "deployment",
    62: "deployment",
    131: "deployment",
    133: "deployment",
    149: "deployment",
    150: "deployment",
    178: "deployment",
    31: "lifecycle",
    32: "lifecycle",
    51: "lifecycle",
    115: "lifecycle",
    128: "lifecycle",
    139: "lifecycle",
    158: "lifecycle",
    33: "lifecycle",
    96: "lifecycle",
    108: "lifecycle",
    114: "experimentation",
    117: "experimentation",
    137: "experimentation",
    138: "lifecycle",
    154: "experimentation",
    155: "experimentation",
    156: "experimentation",
    176: "experimentation",
    118: "experimentation",
    134: "experimentation",
    135: "experimentation",
    136: "experimentation",
    157: "experimentation",
    100: "experimentation",
    84: "experimentation",
    97: "experimentation",
    165: "experimentation",
    177: "monitoring",
    54: "monitoring",
    40: "monitoring",
    159: "monitoring",
    91: "monitoring",
    107: "monitoring",
    153: "monitoring",
    7: "deployment",
    15: "deployment",
    16: "experimentation",
    18: "experimentation",
    19: "lifecycle",
    22: "deployment",
    74: "experimentation",
    80: "deployment",
    85: "lifecycle",
    86: "lifecycle",
    102: "experimentation",
    109: "lifecycle",
    111: "lifecycle",
    132: "deployment",
    143: "lifecycle",
    146: "deployment",
    164: "experimentation",
    182: "deployment",
    190: "lifecycle",
}


def classify(text, qid):
    if qid in OVERRIDES:
        return OVERRIDES[qid]
    low = text.lower()
    scores = {}
    for domain, words in STRONG.items():
        scores[domain] = sum(2 if " " in w else 1 for w in words if w in low)
    best = max(scores, key=scores.get)
    if scores[best] == 0:
        return "experimentation"
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
        elif prev.endswith("/") and not prev.endswith(" /"):
            blocks[-1]["v"] = prev + line
        else:
            blocks[-1]["v"] = prev + " " + line
    else:
        blocks.append({"t": "text", "v": line})


def polish(text):
    reps = [
        ("Startinq", "Starting"),
        ("Autoloqqinq", "Autologging"),
        ("autoloqqinq", "autologging"),
        ("paqe", "page"),
        ("Triqqer", "Trigger"),
        ('formatfdelta")', 'format("delta")'),
        ("Pvfunc", "Pyfunc"),
        ("pvfunc", "pyfunc"),
        ("DataFrarne", "DataFrame"),
        ("qet_run", "get_run"),
        ("Jenson-Shannon", "Jensen-Shannon"),
        ("Jenson", "Jensen"),
        ("MLFIow", "MLflow"),
        ("mflow.register_model", "mlflow.register_model"),
        ("Data bricks", "Databricks"),
        ("the now model", "the new model"),
        ("arc present", "are present"),
        ("pyfunk", "pyfunc"),
        ("</span>", ""),
        ("/span>", ""),
        ("Registry model model", "Registry model `model`"),
        ("a model model", "a model"),
        ("logged model with", "logged the model with"),
        ("not yet logged model", "not yet logged the model"),
        ("gel the data", "get the data"),
        ("rawPredictionCo1", "rawPredictionCol"),
        ("MLFLOW_EXPERIMENT_TD", "MLFLOW_EXPERIMENT_ID"),
        ("rate_1imit", "rate_limit"),
        ("becoming changing", "changing"),
        ("tan accomplish", "can accomplish"),
        ("UI model_uri", "a model_uri"),
        ("with UI model_uri", "with a model_uri"),
    ]
    for a, b in reps:
        text = text.replace(a, b)
    text = re.sub(r"\bmodel model\b", "model", text)
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
    for num, body in re.findall(r'<page number="(\d+)"[^>]*>(.*?)</page>', xml, re.S):
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


def parse_questions(pages):
    questions = []
    current = None
    mode = None
    choice = None

    def start_question(qid, first_line):
        nonlocal current, mode, choice
        current = {
            "id": qid,
            "stem": [],
            "choices": [],
            "answer": [],
            "explanation": [],
        }
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
            qmatch = re.match(r"NO\.(\d+)\b(.*)", text)
            if qmatch and left < 160:
                close()
                rest = qmatch.group(2).strip()
                start_question(int(qmatch.group(1)), rest)
                continue
            if current is None:
                continue
            if text.startswith("Answer"):
                mode = "answer"
                choice = None
                rest = text.split(":", 1)[-1].strip() if ":" in text else ""
                if rest:
                    grab_answer(current, rest)
                    if not re.fullmatch(r"[A-E](?:\s*,\s*[A-E])*", rest):
                        mode = "explanation"
                continue
            if mode == "answer":
                compact = text.replace(" ", "").replace(",", "")
                if text.lower().startswith("explanation"):
                    mode = "explanation"
                    rest = re.sub(r"(?i)^explanation\s*:?", "", text).strip()
                    if rest:
                        merge_text(current["explanation"], rest)
                elif re.fullmatch(r"[A-E]{1,5}", compact) and len(text) <= 8:
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


def grab_answer(question, text):
    letters = re.findall(r"[A-E]", text.upper())
    for letter in letters:
        if letter not in question["answer"]:
            question["answer"].append(letter)


def finalize(questions):
    os.makedirs(FIG_DIR, exist_ok=True)
    for old in os.listdir(FIG_DIR):
        os.remove(os.path.join(FIG_DIR, old))

    used = {}
    finalized = []
    for question in questions:
        qid = question["id"]

        def place(blocks):
            placed = []
            for block in polish_blocks(blocks):
                if block["t"] == "img":
                    ext = os.path.splitext(block["src"])[1].lower() or ".jpg"
                    n = used.get(qid, 0) + 1
                    used[qid] = n
                    name = f"q{qid}-{n}{ext}"
                    shutil.copyfile(block["src"], os.path.join(FIG_DIR, name))
                    placed.append({"t": "img", "src": f"assets/fig/{name}"})
                else:
                    placed.append(block)
            return placed

        stem = place(question["stem"])
        choices = []
        for choice in question["choices"]:
            choices.append({"key": choice["key"], "blocks": place(choice["blocks"])})
        explanation_blocks = polish_blocks(question["explanation"])
        explanation = " ".join(block["v"] for block in explanation_blocks if block["t"] == "text").strip()
        stem_text = " ".join(block["v"] for block in stem if block["t"] == "text")
        choice_text = " ".join(
            block["v"] for choice in choices for block in choice["blocks"] if block["t"] == "text"
        )
        domain = classify(stem_text + " " + choice_text + " " + explanation, qid)
        booklet = list(question["answer"])
        answer = list(booklet)
        note = ""
        if qid in CORRECTIONS:
            corrected, note = CORRECTIONS[qid]
            answer = re.findall(r"[A-E]", corrected.upper())
        multi = len(answer) > 1 or "choose two" in stem_text.lower()
        finalized.append({
            "id": qid,
            "domain": domain,
            "stem": stem,
            "choices": choices,
            "answer": answer,
            "equiv": EQUIV_ANSWERS.get(qid, []),
            "booklet": booklet if booklet != answer else [],
            "note": note,
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
        handle.write("window.QUESTION_BANK = ")
        handle.write(payload)
        handle.write(";\n")
    print(f"questions {len(questions)}")
    missing_choices = [q["id"] for q in questions if len(q["choices"]) < 2]
    bad_answer = [
        q["id"] for q in questions
        if not q["answer"] or any(letter not in {c["key"] for c in q["choices"]} for letter in q["answer"])
    ]
    empty_choice = [
        f"{q['id']}{c['key']}" for q in questions for c in q["choices"] if not c["blocks"]
    ]
    print("missing choices", missing_choices)
    print("bad answer", bad_answer)
    print("empty choice", empty_choice)
    from collections import Counter
    print("domains", Counter(q["domain"] for q in questions))
    print("with images", sum(1 for q in questions if any(b["t"] == "img" for b in q["stem"]) or any(b["t"] == "img" for c in q["choices"] for b in c["blocks"])))
    print("with notes", sum(1 for q in questions if q["note"]))
    print("multi", [q["id"] for q in questions if q["multi"]])


if __name__ == "__main__":
    main()
