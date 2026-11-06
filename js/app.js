(() => {
  const PASS = 70;
  const KEY = "databricks-practice-v2";
  const LEGACY_KEY = "dbml-pro-v1265";

  function emptySlice() {
    return { attempts: [], bookmarks: [], stats: {}, practice: null, exam: null };
  }

  const EXAMS = {
    ml: {
      id: "ml",
      short: "ML Professional",
      title: "Machine Learning Professional",
      version: "V12.65",
      blurb: "실험 추적, 모델 수명주기, 배포, 모니터링",
      bank: Array.isArray(window.QUESTION_BANK) ? window.QUESTION_BANK : [],
      domains: {
        experimentation: "실험·학습",
        lifecycle: "수명주기",
        deployment: "배포·서빙",
        monitoring: "모니터링",
      },
    },
    de: {
      id: "de",
      short: "Data Engineer",
      title: "Data Engineer Professional",
      version: "V15.95",
      blurb: "데이터 처리, 모델링, 거버넌스, 플랫폼, 운영",
      bank: Array.isArray(window.DE_QUESTION_BANK) ? window.DE_QUESTION_BANK : [],
      domains: {
        processing: "데이터 처리",
        modeling: "모델링",
        governance: "거버넌스",
        platform: "플랫폼",
        reliability: "운영·품질",
      },
    },
    da: {
      id: "da",
      short: "Data Analyst",
      title: "Data Analyst Associate",
      version: "V13.35",
      blurb: "Databricks SQL, 데이터 관리, SQL, 시각화, 분석",
      bank: Array.isArray(window.DA_QUESTION_BANK) ? window.DA_QUESTION_BANK : [],
      domains: {
        sql: "SQL",
        management: "데이터 관리",
        warehouse: "Databricks SQL",
        visualization: "시각화",
        analytics: "분석 응용",
      },
    },
  };

  function loadRoot() {
    let root = null;
    try {
      root = JSON.parse(localStorage.getItem(KEY) || "null");
    } catch {
      root = null;
    }
    if (!root || !root.exams) {
      root = { exams: { ml: emptySlice(), de: emptySlice() } };
      try {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
        if (legacy && (legacy.attempts || legacy.stats || legacy.bookmarks)) {
          root.exams.ml = {
            attempts: legacy.attempts || [],
            bookmarks: legacy.bookmarks || [],
            stats: legacy.stats || {},
            practice: null,
            exam: null,
          };
        }
      } catch {
        /* 이전 기록이 없으면 빈 상태로 시작합니다. */
      }
    }
    Object.keys(EXAMS).forEach((id) => {
      root.exams[id] = root.exams[id] || emptySlice();
    });
    return root;
  }

  let rootStore = loadRoot();
  let activeId = null;
  let BANK = [];
  let BY_ID = {};
  let DOMAINS = {};
  let store = emptySlice();
  const ui = { view: "home", resultId: null, bookmarkIndex: 0 };
  let timerHandle = null;

  function save() {
    if (activeId) rootStore.exams[activeId] = store;
    localStorage.setItem(KEY, JSON.stringify(rootStore));
  }

  function selectExam(id) {
    if (!EXAMS[id]) return;
    if (activeId) rootStore.exams[activeId] = store;
    activeId = id;
    const spec = EXAMS[id];
    BANK = spec.bank;
    BY_ID = Object.fromEntries(BANK.map((q) => [q.id, q]));
    DOMAINS = spec.domains;
    store = rootStore.exams[id];
    save();
  }

  function rangeText() {
    return `1번부터 ${BANK.length}번`;
  }

  function scoringHint() {
    const notes = BANK.filter((q) => q.note).length;
    if (!notes) {
      return "정답률은 문항마다 마지막에 풀었던 결과입니다. 다시 맞히면 올라갑니다. 채점은 문제집에 표시된 답을 기준으로 합니다.";
    }
    return `정답률은 문항마다 마지막에 풀었던 결과입니다. 다시 맞히면 올라갑니다. 채점이 문제집 표기와 다른 ${notes}문항은 문서 기준으로 맞습니다.`;
  }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  function isCode(text) {
    return text.length < 320 && /mlflow\.|spark\.|fs\.|client\.|log_|option\(|format\(|write_table|read_table|def |@pandas|sklearn/.test(text);
  }

  function studyHighlight(q) {
    const all = window.STUDY_HIGHLIGHTS;
    if (!all || !activeId || !all[activeId]) return null;
    return all[activeId][q.id] || all[activeId][String(q.id)] || null;
  }

  function markHtml(text, phrases) {
    const source = String(text || "");
    const list = (phrases || []).filter((item) => item && source.includes(item));
    if (!list.length) return esc(source);
    const spans = [];
    list.slice().sort((a, b) => b.length - a.length).forEach((phrase) => {
      let from = 0;
      while (from <= source.length - phrase.length) {
        const at = source.indexOf(phrase, from);
        if (at < 0) break;
        const end = at + phrase.length;
        if (!spans.some(([s, e]) => at < e && end > s)) spans.push([at, end]);
        from = end;
      }
    });
    spans.sort((a, b) => a[0] - b[0]);
    let pos = 0;
    let out = "";
    spans.forEach(([s, e]) => {
      if (s > pos) out += esc(source.slice(pos, s));
      out += `<mark class="hl">${esc(source.slice(s, e))}</mark>`;
      pos = e;
    });
    if (pos < source.length) out += esc(source.slice(pos));
    return out;
  }

  function blocksHtml(blocks, phrases) {
    return blocks.map((block) => {
      if (block.t === "img") {
        return `<img src="${esc(block.src)}" alt="문항의 코드 또는 도식">`;
      }
      const cls = isCode(block.v) ? " class=\"mono\"" : "";
      return `<span${cls}>${markHtml(block.v, phrases)}</span>`;
    }).join("");
  }

  function stemHtml(q, phrases) {
    const parts = [];
    let text = "";
    const flush = () => {
      if (text) {
        parts.push(`<p>${text}</p>`);
        text = "";
      }
    };
    q.stem.forEach((block) => {
      if (block.t === "img") {
        flush();
        parts.push(`<img src="${esc(block.src)}" alt="문항의 코드 또는 도식"><button type="button" class="zoom" data-action="zoom" data-src="${esc(block.src)}">확대</button>`);
      } else {
        const body = markHtml(block.v, phrases);
        text += (text ? " " : "") + (isCode(block.v) ? `<span class="mono">${body}</span>` : body);
      }
    });
    flush();
    return parts.join("");
  }

  function sameAnswer(q, picked) {
    const got = [...(picked || [])].sort().join("");
    if (!got) return false;
    if (q.equiv && q.equiv.length && got.length === 1 && q.equiv.includes(got)) return true;
    const want = [...q.answer].sort().join("");
    return want.length > 0 && want === got;
  }

  function byNumber(ids) {
    return ids.slice().sort((a, b) => a - b);
  }

  function orderedBank() {
    return byNumber(BANK.map((q) => q.id));
  }

  function domainOf(id) {
    return BY_ID[id] ? BY_ID[id].domain : Object.keys(DOMAINS)[0];
  }

  function poolFor(domain, scope) {
    return BANK.filter((q) => {
      if (domain !== "all" && q.domain !== domain) return false;
      const stat = store.stats[q.id];
      if (scope === "unseen") return !stat;
      if (scope === "wrong") return stat && stat.lastCorrect === false;
      if (scope === "bookmark") return store.bookmarks.includes(q.id);
      return true;
    }).map((q) => q.id);
  }

  function recordStat(q, correct) {
    const prev = store.stats[q.id] || { correct: 0, wrong: 0, lastCorrect: false };
    if (correct) prev.correct += 1;
    else prev.wrong += 1;
    prev.lastCorrect = correct;
    store.stats[q.id] = prev;
  }

  function pct(correct, total) {
    if (!total) return 0;
    return Math.round((correct / total) * 1000) / 10;
  }

  function formatDuration(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}분 ${String(s).padStart(2, "0")}초`;
  }

  function formatClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function mastery() {
    const seen = BANK.filter((q) => store.stats[q.id]);
    const correct = seen.filter((q) => store.stats[q.id].lastCorrect).length;
    return { seen: seen.length, correct, total: BANK.length };
  }

  function domainMastery() {
    return Object.keys(DOMAINS).map((domain) => {
      const items = BANK.filter((q) => q.domain === domain);
      const seen = items.filter((q) => store.stats[q.id]);
      const correct = seen.filter((q) => store.stats[q.id].lastCorrect).length;
      return { domain, label: DOMAINS[domain], total: items.length, seen: seen.length, correct };
    });
  }

  function latestExam() {
    return store.attempts.filter((a) => a.kind === "exam").slice(-1)[0] || null;
  }

  function bestScore() {
    if (!store.attempts.length) return null;
    return store.attempts.reduce((best, item) => (item.percent > best.percent ? item : best));
  }

  function pushAttempt(attempt) {
    store.attempts.push(attempt);
    if (store.attempts.length > 40) store.attempts = store.attempts.slice(-40);
    ui.resultId = attempt.id;
  }

  function choiceRows(q, picked, revealed, hl) {
    return q.choices.map((choice) => {
      const on = picked.includes(choice.key);
      const isAnswer = q.answer.includes(choice.key) || (q.equiv && q.equiv.includes(choice.key));
      let cls = "choice";
      if (revealed && isAnswer) cls += " is-correct";
      else if (revealed && on) cls += " is-wrong";
      else if (on) cls += " is-picked";
      const images = choice.blocks.filter((block) => block.t === "img");
      const zoom = images.map((img) => (
        `<button type="button" class="zoom" data-action="zoom" data-src="${esc(img.src)}">확대</button>`
      )).join("");
      const phrases = hl && isAnswer ? hl.answer : null;
      const code = hl && isAnswer && hl.code && !choice.blocks.some((b) => b.t === "text")
        ? `<div class="hl-code"><mark class="hl">${esc(hl.code)}</mark></div>`
        : "";
      return `<div class="choice-row">
        <button type="button" class="${cls}" data-action="pick" data-key="${choice.key}" ${revealed ? "disabled" : ""}>
          <span class="key">${choice.key}</span>
          <span>${blocksHtml(choice.blocks, phrases) || "(그림)"}${code}</span>
        </button>
        ${zoom}
      </div>`;
    }).join("");
  }

  function koExplanation(q) {
    const bank = window.EXPLANATION_KO;
    if (!bank || !activeId || !bank[activeId]) return "";
    const text = bank[activeId][q.id] || bank[activeId][String(q.id)] || "";
    return /[가-힣]/.test(text) ? text : "";
  }

  function answerNotes(q, withKo) {
    const booklet = q.booklet && q.booklet.length ? q.booklet.join(", ") : "";
    const ko = withKo ? koExplanation(q) : "";
    const explanation = q.explanation
      ? `<div class="explain"><strong>문제집 해설</strong>${esc(q.explanation)}${ko ? `<div class="ko-explain"><strong>한글 번역</strong>${esc(ko)}</div>` : ""}</div>`
      : "";
    return `${booklet ? `<div class="note"><strong>문제집 표기는 ${booklet}</strong>이 문항은 문제집에 적힌 답과 Databricks 문서 기준이 달라, 채점은 문서 기준으로 했습니다.</div>` : ""}
      ${q.note ? `<div class="note"><strong>채점 근거</strong>${esc(q.note)}</div>` : ""}
      ${explanation}`;
  }

  function feedbackHtml(q, revealed, studyMode) {
    if (studyMode) {
      return `<div class="feedback">
        <span class="pill good">정답 ${q.answer.join(", ")}</span>
        ${answerNotes(q, true)}
      </div>`;
    }
    if (!revealed) return "";
    const ok = revealed.correct;
    return `<div class="feedback">
      <span class="pill ${ok ? "good" : "bad"}">${ok ? "정답" : "오답"} · 정답 ${q.answer.join(", ")}</span>
      ${answerNotes(q, false)}
    </div>`;
  }

  function questionCard(q, opts) {
    const picked = opts.picked || [];
    const marked = opts.bookmarked;
    const hl = opts.study ? studyHighlight(q) : null;
    const stemCode = hl && hl.code && q.choices.some((c) => q.answer.includes(c.key) && c.blocks.some((b) => b.t === "text"))
      ? `<p class="hl-code">그림 포인트: <mark class="hl">${esc(hl.code)}</mark></p>`
      : "";
    return `<article class="card card-pad">
      <div class="q-top">
        <div class="row">
          <strong>NO.${q.id}</strong>
          <span class="pill ${q.domain}">${DOMAINS[q.domain]}</span>
          ${q.multi ? '<span class="pill warn">복수 정답</span>' : ""}
        </div>
        <button type="button" class="btn" data-action="bookmark" data-id="${q.id}">${marked ? "북마크 해제" : "북마크"}</button>
      </div>
      <div class="stem">${stemHtml(q, hl && hl.stem)}${stemCode}</div>
      ${q.multi && !opts.study ? '<p class="hint">해당하는 보기를 모두 고르세요. 일부만 맞으면 오답입니다.</p>' : ""}
      <div class="choices">${choiceRows(q, picked, opts.study ? { correct: true } : opts.revealed, hl)}</div>
      ${feedbackHtml(q, opts.revealed, opts.study)}
      <div class="actions">${opts.actions || ""}</div>
      <p class="hint">${opts.hint || (opts.study ? "<kbd>←</kbd> <kbd>→</kbd> 이전·다음 · <kbd>Enter</kbd> 다음 · <kbd>B</kbd> 북마크" : `<kbd>1</kbd>–<kbd>5</kbd> 선택 · <kbd>Enter</kbd> 채점 또는 다음 · <kbd>B</kbd> 북마크${opts.examKeys ? " · <kbd>F</kbd> 표시" : ""}`)}</p>
    </article>`;
  }

  function syncChrome() {
    const spec = activeId ? EXAMS[activeId] : null;
    document.querySelector(".brand h1").textContent = spec ? spec.short : "자격 시험";
    document.querySelector(".brand-sub").textContent = spec ? `${spec.version} 연습 대시보드` : "연습할 시험을 고르세요";
    const current = ui.view === "result" ? "dashboard" : ui.view === "review" ? "review" : ui.view;
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.hidden = btn.dataset.view !== "home" && !activeId;
      btn.classList.toggle("is-active", btn.dataset.view === current);
    });
  }

  function sideStats() {
    const host = document.getElementById("side-stats");
    if (!activeId) {
      host.innerHTML = `<div class="side-stat"><span>등록된 시험</span><strong>${Object.keys(EXAMS).length}</strong></div>`;
      return;
    }
    const m = mastery();
    const latest = latestExam();
    host.innerHTML = `
      <div class="side-stat"><span>최근 모의고사</span><strong>${latest ? `${latest.percent}%` : "—"}</strong></div>
      <div class="side-stat"><span>최근 정답으로 맞춘 문항</span><strong>${m.correct}/${m.total}</strong></div>
      <button type="button" class="side-stat side-link ${ui.view === "bookmarks" ? "is-active" : ""}" data-action="open-bookmarks"><span>북마크</span><strong>${store.bookmarks.length}</strong></button>`;
  }

  function ring(percent) {
    const r = 52;
    const c = 2 * Math.PI * r;
    const offset = c * (1 - Math.max(0, Math.min(100, percent)) / 100);
    const color = percent >= PASS ? "var(--good)" : "var(--accent)";
    return `<svg class="ring" viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="${r}" fill="none" stroke="#e7edf3" stroke-width="10"/>
      <circle cx="60" cy="60" r="${r}" fill="none" stroke="${color}" stroke-width="10"
        stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"
        transform="rotate(-90 60 60)"/>
      <text x="60" y="64" text-anchor="middle" font-size="22" font-weight="700" fill="#1b2430">${Math.round(percent)}%</text>
    </svg>`;
  }

  function renderDashboard() {
    const m = mastery();
    const latest = latestExam();
    const best = bestScore();
    const rate = pct(m.correct, m.seen);
    const domains = domainMastery();
    const attempts = store.attempts.slice().reverse().slice(0, 8);
    const history = store.attempts.slice(-12);
    const weak = BANK
      .filter((q) => store.stats[q.id] && !store.stats[q.id].lastCorrect)
      .sort((a, b) => (store.stats[b.id].wrong - store.stats[a.id].wrong) || (a.id - b.id))
      .slice(0, 6);
    const hero = latest ? latest.percent : (m.seen ? rate : 0);
    const heroLabel = latest ? "최근 모의고사" : (m.seen ? "풀어 본 문항의 최근 정답률" : "아직 기록이 없습니다");

    const domainRows = domains.map((d) => {
      const width = d.seen ? pct(d.correct, d.seen) : 0;
      return `<div class="domain-row">
        <span>${d.label}</span>
        <div class="track"><span style="width:${width}%"></span></div>
        <b>${d.seen ? `${width}%` : "—"}</b>
      </div>
      <p class="hint" style="margin:-4px 0 8px">${d.correct}/${d.seen} 맞춤 · 문항 ${d.total}개</p>`;
    }).join("");

    const bars = history.length
      ? `<div class="bars" aria-label="최근 응시 점수">${history.map((item) => {
          const h = Math.max(4, item.percent);
          return `<div class="bar-col" title="${esc(item.title)} ${item.percent}%">
            <i class="${item.percent >= PASS ? "pass" : ""}" style="height:${h}%"></i>
            <small>${Math.round(item.percent)}</small>
          </div>`;
        }).join("")}</div>
        <p class="hint">세로축은 점수(%)입니다. 초록 막대는 학습 합격선 ${PASS}% 이상입니다. 최근 ${history.length}회.</p>`
      : `<p class="empty">모의고사나 연습 세트를 끝내면 점수 막대가 여기에 쌓입니다.</p>`;

    const rows = attempts.length
      ? attempts.map((item) => `<tr>
          <td>${esc(item.title)}</td>
          <td class="num">${item.correct}/${item.total}</td>
          <td class="num">${item.percent}%</td>
          <td>${item.percent >= PASS ? '<span class="pill good">기준 통과</span>' : '<span class="pill bad">기준 미달</span>'}</td>
          <td><button type="button" class="btn" data-action="open-result" data-id="${item.id}">결과</button></td>
        </tr>`).join("")
      : `<tr><td colspan="5">아직 저장된 응시가 없습니다.</td></tr>`;

    const weakRows = weak.length
      ? weak.map((q) => {
          const stat = store.stats[q.id];
          const stem = q.stem.find((block) => block.t === "text");
          return `<tr>
            <td>NO.${q.id}</td>
            <td><span class="pill ${q.domain}">${DOMAINS[q.domain]}</span></td>
            <td>${esc((stem ? stem.v : "").slice(0, 80))}</td>
            <td class="num">${stat.wrong}</td>
          </tr>`;
        }).join("")
      : "";

    return `<div class="page-head">
      <div>
        <h2>성적 대시보드</h2>
        <p>${esc(EXAMS[activeId].title)} ${BANK.length}문항을 번호순으로 풀고, 영역별 점수와 오답을 확인합니다.</p>
      </div>
      <div class="row">
        <button type="button" class="btn primary" data-action="start-exam">${rangeText()}</button>
        <button type="button" class="btn" data-action="go" data-view="study">공부</button>
        <button type="button" class="btn" data-action="go" data-view="practice">연습 시작</button>
      </div>
    </div>
    <section class="stats">
      <div class="card score-hero">
        ${ring(hero)}
        <p class="ring-label">${heroLabel}${latest ? `<strong>${latest.correct}/${latest.total}</strong>` : ""}</p>
      </div>
      <div class="card card-pad">
        <h3>누적 현황</h3>
        <div class="metric-grid">
          <div class="metric"><span>풀어 본 문항</span><strong>${m.seen}</strong><em>/ ${m.total}</em></div>
          <div class="metric"><span>최근 시도 정답률</span><strong>${m.seen ? rate : 0}%</strong><em>${m.correct}문항 맞춤</em></div>
          <div class="metric"><span>최고 응시 점수</span><strong>${best ? `${best.percent}%` : "—"}</strong><em>${store.attempts.length}회 기록</em></div>
        </div>
        <p class="hint">${scoringHint()}</p>
      </div>
    </section>
    <section class="split">
      <div class="card card-pad">
        <h3>영역별 최근 정답률</h3>
        ${domainRows}
        <div class="row">
          ${Object.entries(DOMAINS).map(([id, label]) => `<button type="button" class="btn" data-action="practice-domain" data-domain="${id}">${label}만 연습</button>`).join("")}
        </div>
      </div>
      <div class="card card-pad">
        <h3>최근 응시 점수</h3>
        ${bars}
      </div>
    </section>
    <section class="split" style="margin-top:16px">
      <div class="card card-pad">
        <h3>응시 기록</h3>
        <table>
          <thead><tr><th>세트</th><th class="num">점수</th><th class="num">비율</th><th>기준</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="card card-pad">
        <h3>다시 볼 오답</h3>
        ${weakRows ? `<table><thead><tr><th>번호</th><th>영역</th><th>문항</th><th class="num">오답</th></tr></thead><tbody>${weakRows}</tbody></table>` : `<p class="empty">최근에 틀린 문항이 없습니다. 연습을 시작하면 여기에 모입니다.</p>`}
        <div class="actions"><button type="button" class="btn" data-action="go" data-view="review">오답만 다시 풀기</button></div>
      </div>
    </section>
    <div class="actions">
      <button type="button" class="btn" data-action="export">기록 내보내기</button>
      <button type="button" class="btn" data-action="import">기록 가져오기</button>
      <button type="button" class="btn warn" data-action="reset">기록 지우기</button>
      <input id="import-file" type="file" accept="application/json" hidden>
    </div>`;
  }

  function renderPractice(forceReview) {
    if (forceReview && (!store.practice || store.practice.scope !== "wrong")) {
      const ids = poolFor("all", "wrong");
      if (!ids.length) {
        return `<div class="page-head"><div><h2>오답 복습</h2><p>최근에 틀린 문항이 없습니다.</p></div></div>
          <div class="card card-pad"><p>연습을 시작하거나 모의고사를 제출하면 오답이 여기에 모입니다.</p>
          <div class="actions"><button type="button" class="btn primary" data-action="go" data-view="practice">연습으로 이동</button></div></div>`;
      }
      store.practice = {
        ids: byNumber(ids),
        index: 0,
        picks: {},
        revealed: {},
        scope: "wrong",
        title: `오답 복습 ${ids.length}문항`,
        startedAt: Date.now(),
        saved: false,
      };
      save();
    }

    const session = store.practice;
    if (!session) return practiceSetup("연습");

    const q = BY_ID[session.ids[session.index]];
    const revealed = session.revealed[q.id];
    const picked = revealed ? revealed.picked : (session.picks[q.id] || []);
    const answered = Object.keys(session.revealed).length;
    const correct = Object.values(session.revealed).filter((item) => item.correct).length;
    const width = (answered / session.ids.length) * 100;
    const atEnd = session.index >= session.ids.length - 1;
    const actions = [];
    if (!revealed) {
      actions.push(`<button type="button" class="btn primary" data-action="grade">정답 확인</button>`);
    } else if (!atEnd) {
      actions.push(`<button type="button" class="btn primary" data-action="next">다음 문항</button>`);
    } else {
      actions.push(`<button type="button" class="btn primary" data-action="finish-practice">결과 보기</button>`);
    }
    if (session.index > 0) actions.push(`<button type="button" class="btn" data-action="prev">이전</button>`);
    actions.push(`<button type="button" class="btn" data-action="end-practice">세트 종료</button>`);

    return `<div class="page-head">
      <div>
        <h2>${esc(session.title)}</h2>
        <p>${session.index + 1} / ${session.ids.length} · 채점 ${correct}/${answered}</p>
      </div>
    </div>
    <div class="progress-line"><span style="width:${width}%"></span></div>
    ${questionCard(q, {
      picked,
      revealed,
      bookmarked: store.bookmarks.includes(q.id),
      actions: actions.join(""),
    })}`;
  }

  function practiceSetup(title) {
    const domainOptions = [`<option value="all">전 영역</option>`]
      .concat(Object.entries(DOMAINS).map(([id, label]) => `<option value="${id}">${label}</option>`))
      .join("");
    return `<div class="page-head"><div><h2>${title}</h2><p>${rangeText()}까지 번호순으로 풀고, 바로 채점받습니다.</p></div></div>
      <form class="card card-pad" data-action="start-practice">
        <div class="filters">
          <label class="field">영역<select id="practice-domain">${domainOptions}</select></label>
          <label class="field">범위
            <select id="practice-scope">
              <option value="all">${rangeText()} 전체</option>
              <option value="unseen">아직 안 푼 문항</option>
              <option value="wrong">최근 오답</option>
              <option value="bookmark">북마크</option>
            </select>
          </label>
        </div>
        <button type="submit" class="btn primary">1번부터 시작</button>
        <p class="hint">문항은 항상 번호가 커지는 순서로 나옵니다. 전 영역을 고르면 NO.1부터 NO.${BANK.length}까지입니다.</p>
        <p id="practice-error" class="hint"></p>
      </form>`;
  }

  function renderExam() {
    const exam = store.exam;
    if (!exam) {
      return `<div class="page-head">
        <div>
          <h2>모의고사</h2>
          <p>NO.1부터 NO.${BANK.length}까지 번호순으로 풀습니다. 제출 전에는 정답이 보이지 않습니다.</p>
        </div>
      </div>
      <div class="preset-grid">
        <button type="button" class="preset" data-action="start-exam"><strong>${rangeText()}</strong><span>번호순 · 시간 제한 없음 · 끝까지 같은 순서</span></button>
      </div>`;
    }

    const q = BY_ID[exam.questionIds[exam.index]];
    const picked = exam.answers[q.id] || [];
    const remain = exam.deadline ? exam.deadline - Date.now() : null;
    const low = remain !== null && remain < 5 * 60 * 1000;
    const actions = [
      exam.index > 0 ? `<button type="button" class="btn" data-action="exam-prev">이전</button>` : "",
      exam.index < exam.questionIds.length - 1 ? `<button type="button" class="btn" data-action="exam-next">다음</button>` : "",
      `<button type="button" class="btn" data-action="flag">${exam.flags.includes(q.id) ? "표시 해제" : "나중에 보기"}</button>`,
      `<button type="button" class="btn primary" data-action="submit-exam">제출하고 채점</button>`,
      `<button type="button" class="btn warn" data-action="abandon-exam">시험 버리기</button>`,
    ].join("");
    const dots = exam.questionIds.map((id, index) => {
      const answered = (exam.answers[id] || []).length > 0;
      const flagged = exam.flags.includes(id);
      const cls = ["nav-dot", index === exam.index ? "is-current" : "", answered ? "is-answered" : "", flagged ? "is-flagged" : ""].filter(Boolean).join(" ");
      return `<button type="button" class="${cls}" data-action="jump" data-index="${index}">${index + 1}</button>`;
    }).join("");

    return `<div class="page-head">
      <div>
        <h2>${esc(exam.title)}</h2>
        <p>${exam.index + 1} / ${exam.questionIds.length} · 응답 ${Object.values(exam.answers).filter((list) => list.length).length}문항</p>
      </div>
      <div class="timer ${low ? "low" : ""}" id="timer">${remain === null ? "제한 없음" : formatClock(remain)}</div>
    </div>
    <div class="exam-layout">
      ${questionCard(q, {
        picked,
        revealed: null,
        bookmarked: store.bookmarks.includes(q.id),
        actions,
        examKeys: true,
      })}
      <aside class="card card-pad">
        <h3>문항 이동</h3>
        <div class="nav-grid">${dots}</div>
        <p class="hint">색이 채워진 칸은 답을 고른 문항입니다. 노란 테두리는 나중에 보기로 표시한 문항입니다.</p>
      </aside>
    </div>`;
  }

  function renderResult() {
    const attempt = store.attempts.find((item) => item.id === ui.resultId) || store.attempts[store.attempts.length - 1];
    if (!attempt) {
      return `<div class="page-head"><div><h2>결과</h2><p>저장된 응시가 없습니다.</p></div></div>`;
    }
    const domains = Object.keys(DOMAINS).map((domain) => {
      const rows = attempt.questionIds.filter((id) => domainOf(id) === domain);
      const correct = rows.filter((id) => attempt.detail[id].correct).length;
      return { domain, total: rows.length, correct };
    }).filter((row) => row.total);
    const wrong = attempt.questionIds.filter((id) => !attempt.detail[id].correct);
    const blocks = wrong.map((id) => {
      const q = BY_ID[id];
      const detail = attempt.detail[id];
      return `<div class="review-block">${questionCard(q, {
        picked: detail.picked,
        revealed: { correct: false, picked: detail.picked },
        bookmarked: store.bookmarks.includes(id),
        actions: "",
      })}</div>`;
    }).join("");

    return `<div class="page-head">
      <div>
        <h2>${esc(attempt.title)} 결과</h2>
        <p>${new Date(attempt.finishedAt).toLocaleString("ko-KR")} · ${formatDuration(attempt.durationSec)}</p>
      </div>
      <div class="row">
        <button type="button" class="btn" data-action="go" data-view="dashboard">대시보드</button>
        <button type="button" class="btn primary" data-action="retry-wrong" ${wrong.length ? "" : "disabled"}>틀린 문항만 다시</button>
      </div>
    </div>
    <section class="stats">
      <div class="card score-hero">
        ${ring(attempt.percent)}
        <p class="ring-label">${attempt.percent >= PASS ? "학습 합격선 통과" : "학습 합격선 미달"}<strong>${attempt.correct}/${attempt.total}</strong></p>
      </div>
      <div class="card card-pad">
        <h3>영역별 점수</h3>
        ${domains.map((row) => `<div class="domain-row"><span>${DOMAINS[row.domain]}</span><div class="track"><span style="width:${pct(row.correct, row.total)}%"></span></div><b>${row.correct}/${row.total}</b></div>`).join("")}
      </div>
    </section>
    <section class="card card-pad" style="margin-top:16px">
      <h3>틀린 문항 ${wrong.length}개</h3>
      ${blocks || `<p class="empty">틀린 문항이 없습니다.</p>`}
    </section>`;
  }

  function renderHome() {
    const cards = Object.values(EXAMS).map((spec) => {
      const slice = rootStore.exams[spec.id] || emptySlice();
      const latest = (slice.attempts || []).filter((item) => item.kind === "exam").slice(-1)[0];
      const seen = Object.keys(slice.stats || {}).length;
      return `<article class="card card-pad pick">
        <p class="pick-kicker">${esc(spec.version)}</p>
        <h2>${esc(spec.title)}</h2>
        <p>${esc(spec.blurb)}</p>
        <p class="hint">${spec.bank.length}문항 · 풀어 본 문항 ${seen}개 · 최근 모의고사 ${latest ? `${latest.percent}%` : "없음"}</p>
        <div class="actions">
          <button type="button" class="btn primary" data-action="enter" data-exam="${spec.id}" data-next="study">공부</button>
          <button type="button" class="btn" data-action="enter" data-exam="${spec.id}" data-next="practice">연습</button>
          <button type="button" class="btn" data-action="enter" data-exam="${spec.id}" data-next="exam">모의고사</button>
          <button type="button" class="btn" data-action="enter" data-exam="${spec.id}" data-next="dashboard">성적</button>
          ${(slice.bookmarks || []).length ? `<button type="button" class="btn" data-action="enter" data-exam="${spec.id}" data-next="bookmarks">북마크 ${(slice.bookmarks || []).length}</button>` : ""}
        </div>
      </article>`;
    }).join("");
    return `<div class="page-head">
      <div>
        <h2>시험을 선택하세요</h2>
        <p>공부, 연습, 모의고사는 고른 시험의 1번부터 마지막 번호까지 순서대로 진행됩니다. 공부에서는 답을 바로 볼 수 있고, 성적과 오답은 시험마다 따로 저장됩니다.</p>
      </div>
    </div>
    <div class="pick-grid">${cards}</div>`;
  }

  function render() {
    const root = document.getElementById("main");
    syncChrome();
    if (ui.view === "home" || !activeId) {
      ui.view = "home";
      root.innerHTML = renderHome();
      sideStats();
      return;
    }
    if (!BANK.length) {
      root.innerHTML = `<div class="card card-pad"><h2>문항을 찾지 못했습니다</h2><p>선택한 시험의 문제 파일을 확인해 주세요.</p></div>`;
      sideStats();
      return;
    }
    if (ui.view === "dashboard") root.innerHTML = renderDashboard();
    else if (ui.view === "study") root.innerHTML = renderStudy();
    else if (ui.view === "bookmarks") root.innerHTML = renderBookmarks();
    else if (ui.view === "practice") root.innerHTML = renderPractice(false);
    else if (ui.view === "review") root.innerHTML = renderPractice(true);
    else if (ui.view === "exam") root.innerHTML = renderExam();
    else if (ui.view === "result") root.innerHTML = renderResult();
    sideStats();
    const timer = document.getElementById("timer");
    if (timer && store.exam && store.exam.deadline) {
      const remain = store.exam.deadline - Date.now();
      timer.textContent = formatClock(remain);
      timer.classList.toggle("low", remain < 5 * 60 * 1000);
    }
  }

  function startPractice(domain, scope, title) {
    const ids = byNumber(poolFor(domain, scope));
    if (!ids.length) return false;
    const domainLabel = domain === "all" ? rangeText() : DOMAINS[domain];
    store.practice = {
      ids,
      index: 0,
      picks: {},
      revealed: {},
      scope,
      title: title || `연습 · ${domainLabel} ${ids.length}문항`,
      startedAt: Date.now(),
      saved: false,
    };
    save();
    return true;
  }

  function finishPractice(openResult) {
    const session = store.practice;
    if (!session) return;
    const revealed = session.revealed;
    const ids = Object.keys(revealed).map(Number);
    if (!ids.length) {
      store.practice = null;
      save();
      ui.view = "dashboard";
      render();
      return;
    }
    if (!session.saved) {
      const correct = ids.filter((id) => revealed[id].correct).length;
      const detail = {};
      ids.forEach((id) => {
        detail[id] = { picked: revealed[id].picked, correct: revealed[id].correct };
      });
      pushAttempt({
        id: Date.now(),
        kind: "practice",
        title: session.title,
        questionIds: ids,
        detail,
        correct,
        total: ids.length,
        percent: pct(correct, ids.length),
        startedAt: session.startedAt,
        finishedAt: Date.now(),
        durationSec: Math.round((Date.now() - session.startedAt) / 1000),
      });
      session.saved = true;
    }
    store.practice = null;
    save();
    ui.view = openResult ? "result" : "dashboard";
    render();
  }

  function startExam() {
    if (store.exam && !window.confirm("진행 중인 모의고사를 버리고 새로 시작할까요?")) return;
    const ids = orderedBank();
    store.exam = {
      title: `${rangeText()} 번호순`,
      questionIds: ids,
      index: 0,
      answers: {},
      flags: [],
      startedAt: Date.now(),
      deadline: null,
    };
    save();
    ui.view = "exam";
    render();
  }

  function submitExam(auto) {
    const exam = store.exam;
    if (!exam) return;
    const unanswered = exam.questionIds.filter((id) => !(exam.answers[id] || []).length).length;
    if (!auto && unanswered && !window.confirm(`아직 답을 고르지 않은 문항이 ${unanswered}개 있습니다. 제출할까요?`)) return;
    const detail = {};
    let correct = 0;
    exam.questionIds.forEach((id) => {
      const q = BY_ID[id];
      const picked = exam.answers[id] || [];
      const ok = sameAnswer(q, picked);
      detail[id] = { picked, correct: ok };
      if (ok) correct += 1;
      recordStat(q, ok);
    });
    pushAttempt({
      id: Date.now(),
      kind: "exam",
      title: exam.title,
      questionIds: exam.questionIds.slice(),
      detail,
      correct,
      total: exam.questionIds.length,
      percent: pct(correct, exam.questionIds.length),
      startedAt: exam.startedAt,
      finishedAt: Date.now(),
      durationSec: Math.round((Date.now() - exam.startedAt) / 1000),
    });
    store.exam = null;
    save();
    ui.view = "result";
    render();
  }

  function studyIndex() {
    const last = Math.max(0, BANK.length - 1);
    const index = Number(store.studyIndex) || 0;
    return Math.min(Math.max(0, index), last);
  }

  function moveStudy(index) {
    store.studyIndex = index;
    save();
    render();
  }

  function renderStudy() {
    const ids = orderedBank();
    const index = studyIndex();
    const q = BY_ID[ids[index]];
    const actions = [
      index > 0 ? `<button type="button" class="btn" data-action="study-prev">이전</button>` : "",
      index < ids.length - 1 ? `<button type="button" class="btn primary" data-action="study-next">다음 문항</button>` : "",
    ].join("");
    const dots = ids.map((id, dotIndex) => {
      const cls = ["nav-dot", dotIndex === index ? "is-current" : ""].filter(Boolean).join(" ");
      return `<button type="button" class="${cls}" data-action="study-jump" data-index="${dotIndex}">${id}</button>`;
    }).join("");
    return `<div class="page-head">
      <div>
        <h2>공부 · ${esc(EXAMS[activeId].short)}</h2>
        <p>${index + 1} / ${ids.length} · ${rangeText()}까지 정답을 확인합니다. 점수는 기록되지 않습니다.</p>
      </div>
    </div>
    <div class="progress-line"><span style="width:${((index + 1) / ids.length) * 100}%"></span></div>
    <div class="exam-layout">
      ${questionCard(q, {
        picked: q.answer.slice(),
        study: true,
        bookmarked: store.bookmarks.includes(q.id),
        actions,
      })}
      <aside class="card card-pad">
        <h3>문항 이동</h3>
        <div class="nav-grid">${dots}</div>
        <p class="hint">번호는 문제 번호입니다. 초록색 보기가 정답입니다.</p>
      </aside>
    </div>`;
  }

  function bookmarkIds() {
    const seen = new Set();
    const ids = [];
    (store.bookmarks || []).forEach((raw) => {
      const id = Number(raw);
      if (!id || !BY_ID[id] || seen.has(id)) return;
      seen.add(id);
      ids.push(id);
    });
    return byNumber(ids);
  }

  function moveBookmark(index) {
    const ids = bookmarkIds();
    if (!ids.length) return;
    ui.bookmarkIndex = Math.min(Math.max(0, index), ids.length - 1);
    render();
  }

  function renderBookmarks() {
    const ids = bookmarkIds();
    if (!ids.length) {
      return `<div class="page-head"><div><h2>북마크</h2><p>북마크한 문항이 없습니다.</p></div></div>
        <div class="card card-pad"><p>공부, 연습, 모의고사에서 북마크한 문항이 여기에 모입니다.</p></div>`;
    }
    if (ui.bookmarkIndex >= ids.length) ui.bookmarkIndex = 0;
    const index = ui.bookmarkIndex;
    const q = BY_ID[ids[index]];
    const actions = [
      index > 0 ? `<button type="button" class="btn" data-action="bookmark-prev">이전</button>` : "",
      index < ids.length - 1 ? `<button type="button" class="btn primary" data-action="bookmark-next">다음 북마크</button>` : "",
    ].join("");
    const links = ids.map((id, linkIndex) => {
      const stem = (BY_ID[id].stem.find((block) => block.t === "text") || { v: "" }).v;
      const cls = linkIndex === index ? "bookmark-link is-current" : "bookmark-link";
      return `<button type="button" class="${cls}" data-action="bookmark-open" data-index="${linkIndex}"><strong>NO.${id}</strong><span>${esc(stem.slice(0, 72))}</span></button>`;
    }).join("");
    return `<div class="page-head">
      <div>
        <h2>북마크 공부 · ${esc(EXAMS[activeId].short)}</h2>
        <p>${index + 1} / ${ids.length} · 북마크한 문항만 번호순으로 공부합니다. 응시 기록은 바뀌지 않습니다.</p>
      </div>
    </div>
    <div class="exam-layout">
      ${questionCard(q, {
        picked: q.answer.slice(),
        study: true,
        bookmarked: true,
        actions,
        hint: "<kbd>←</kbd> <kbd>→</kbd> 이전·다음 북마크 · <kbd>B</kbd> 북마크 해제",
      })}
      <aside class="card card-pad">
        <h3>북마크 목록</h3>
        <div class="bookmark-list">${links}</div>
      </aside>
    </div>`;
  }

  function currentQuestion() {
    if (ui.view === "bookmarks") {
      const ids = bookmarkIds();
      return ids.length ? BY_ID[ids[Math.min(ui.bookmarkIndex, ids.length - 1)]] : null;
    }
    if (ui.view === "study") return BY_ID[orderedBank()[studyIndex()]];
    if (ui.view === "exam" && store.exam) return BY_ID[store.exam.questionIds[store.exam.index]];
    if ((ui.view === "practice" || ui.view === "review") && store.practice) {
      return BY_ID[store.practice.ids[store.practice.index]];
    }
    return null;
  }

  function pick(key) {
    if (ui.view === "study" || ui.view === "bookmarks") return;
    const q = currentQuestion();
    if (!q) return;
    if (ui.view === "exam" && store.exam) {
      const list = store.exam.answers[q.id] || [];
      store.exam.answers[q.id] = q.multi
        ? (list.includes(key) ? list.filter((item) => item !== key) : list.concat(key))
        : [key];
      save();
      render();
      return;
    }
    const session = store.practice;
    if (!session || session.revealed[q.id]) return;
    const list = session.picks[q.id] || [];
    session.picks[q.id] = q.multi
      ? (list.includes(key) ? list.filter((item) => item !== key) : list.concat(key))
      : [key];
    save();
    render();
  }

  function gradeCurrent() {
    const session = store.practice;
    const q = currentQuestion();
    if (!session || !q || session.revealed[q.id]) return;
    const picked = session.picks[q.id] || [];
    if (!picked.length) return;
    const correct = sameAnswer(q, picked);
    session.revealed[q.id] = { correct, picked: picked.slice() };
    recordStat(q, correct);
    save();
    render();
  }

  function toggleBookmark(id) {
    const num = Number(id);
    if (store.bookmarks.includes(num)) store.bookmarks = store.bookmarks.filter((item) => item !== num);
    else store.bookmarks.push(num);
    save();
    render();
  }

  function go(view) {
    if (ui.view === "exam" && view !== "exam" && store.exam) {
      if (!window.confirm("모의고사는 이 자리에 그대로 남습니다. 화면만 이동할까요?")) return;
    }
    if (view === "home") {
      ui.view = "home";
      render();
      return;
    }
    if (!activeId) {
      ui.view = "home";
      render();
      return;
    }
    if (view === "practice" && ui.view === "review") store.practice = null;
    if (view === "review") {
      if (store.practice && store.practice.scope !== "wrong") {
        const graded = Object.keys(store.practice.revealed).length;
        if (graded && !window.confirm("진행 중인 연습을 기록하고 오답 복습으로 옮길까요?")) return;
        if (graded) finishPractice(false);
        else store.practice = null;
      }
      ui.view = "review";
      render();
      return;
    }
    if (view === "practice" && store.practice && store.practice.scope === "wrong") {
      store.practice = null;
    }
    if (view === "bookmarks") ui.bookmarkIndex = 0;
    ui.view = view;
    render();
  }

  document.body.addEventListener("click", (event) => {
    const el = event.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action;
    if (action === "open-bookmarks") go("bookmarks");
    else if (action === "go") go(el.dataset.view);
    else if (action === "enter") {
      selectExam(el.dataset.exam);
      if (el.dataset.next === "bookmarks") ui.bookmarkIndex = 0;
      ui.view = el.dataset.next || "dashboard";
      render();
    }
    else if (action === "study-next") moveStudy(Math.min(BANK.length - 1, studyIndex() + 1));
    else if (action === "study-prev") moveStudy(Math.max(0, studyIndex() - 1));
    else if (action === "study-jump") moveStudy(Number(el.dataset.index));
    else if (action === "bookmark-next") moveBookmark(ui.bookmarkIndex + 1);
    else if (action === "bookmark-prev") moveBookmark(ui.bookmarkIndex - 1);
    else if (action === "bookmark-open") moveBookmark(Number(el.dataset.index));
    else if (action === "pick") pick(el.dataset.key);
    else if (action === "grade") gradeCurrent();
    else if (action === "next" && store.practice) {
      store.practice.index = Math.min(store.practice.ids.length - 1, store.practice.index + 1);
      save();
      render();
    } else if (action === "prev" && store.practice) {
      store.practice.index = Math.max(0, store.practice.index - 1);
      save();
      render();
    } else if (action === "finish-practice") finishPractice(true);
    else if (action === "end-practice") {
      if (window.confirm("지금까지 채점한 문항만 기록하고 세트를 끝낼까요?")) finishPractice(true);
    } else if (action === "bookmark") toggleBookmark(el.dataset.id);
    else if (action === "zoom") {
      document.getElementById("lightbox-img").src = el.dataset.src;
      document.getElementById("lightbox").hidden = false;
    } else if (action === "close-zoom") {
      document.getElementById("lightbox").hidden = true;
    } else if (action === "start-exam") startExam();
    else if (action === "exam-next" && store.exam) {
      store.exam.index = Math.min(store.exam.questionIds.length - 1, store.exam.index + 1);
      save();
      render();
    } else if (action === "exam-prev" && store.exam) {
      store.exam.index = Math.max(0, store.exam.index - 1);
      save();
      render();
    } else if (action === "jump" && store.exam) {
      store.exam.index = Number(el.dataset.index);
      save();
      render();
    } else if (action === "flag" && store.exam) {
      const id = store.exam.questionIds[store.exam.index];
      store.exam.flags = store.exam.flags.includes(id)
        ? store.exam.flags.filter((item) => item !== id)
        : store.exam.flags.concat(id);
      save();
      render();
    } else if (action === "submit-exam") submitExam(false);
    else if (action === "abandon-exam") {
      if (!window.confirm("이 모의고사를 점수에 남기지 않고 버릴까요?")) return;
      store.exam = null;
      save();
      render();
    }
    else if (action === "open-result") {
      ui.resultId = Number(el.dataset.id);
      ui.view = "result";
      render();
    } else if (action === "practice-domain") {
      startPractice(el.dataset.domain, "all", `${DOMAINS[el.dataset.domain]} 번호순`);
      ui.view = "practice";
      render();
    } else if (action === "retry-wrong") {
      const attempt = store.attempts.find((item) => item.id === ui.resultId);
      if (!attempt) return;
      const ids = byNumber(attempt.questionIds.filter((id) => !attempt.detail[id].correct));
      store.practice = {
        ids,
        index: 0,
        picks: {},
        revealed: {},
        scope: "set",
        title: "틀린 문항 다시 풀기",
        startedAt: Date.now(),
        saved: false,
      };
      save();
      ui.view = "practice";
      render();
    } else if (action === "reset") {
      if (!activeId) return;
      if (!window.confirm(`${EXAMS[activeId].short}의 응시 기록, 북마크, 진행 중인 시험만 지울까요?`)) return;
      store = emptySlice();
      save();
      ui.view = "dashboard";
      render();
    } else if (action === "export") {
      if (activeId) rootStore.exams[activeId] = store;
      const blob = new Blob([JSON.stringify(rootStore)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "databricks-practice.json";
      link.click();
      URL.revokeObjectURL(url);
    } else if (action === "import") {
      document.getElementById("import-file").click();
    }
  });

  document.body.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-action='start-practice']");
    if (!form) return;
    event.preventDefault();
    const domain = document.getElementById("practice-domain").value;
    const scope = document.getElementById("practice-scope").value;
    const ok = startPractice(domain, scope);
    const error = document.getElementById("practice-error");
    if (!ok) {
      error.textContent = "이 조건에 해당하는 문항이 없습니다.";
      return;
    }
    ui.view = "practice";
    render();
  });

  document.body.addEventListener("change", (event) => {
    if (event.target.id !== "import-file" || !event.target.files[0]) return;
    const file = event.target.files[0];
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.exams) {
          rootStore = { exams: {} };
          Object.keys(EXAMS).forEach((id) => {
            rootStore.exams[id] = data.exams[id] || emptySlice();
          });
          if (activeId) store = rootStore.exams[activeId];
          save();
          ui.view = activeId ? "dashboard" : "home";
        } else {
          if (!activeId) selectExam("ml");
          store = {
            attempts: data.attempts || [],
            bookmarks: data.bookmarks || [],
            stats: data.stats || {},
            practice: data.practice || null,
            exam: data.exam || null,
          };
          save();
          ui.view = "dashboard";
        }
        render();
      } catch {
        window.alert("JSON 기록을 읽지 못했습니다.");
      }
    };
    reader.readAsText(file);
  });

  document.addEventListener("keydown", (event) => {
    if (event.target.matches("input, select, textarea")) return;
    const q = currentQuestion();
    if (!q) return;
    if (ui.view === "study") {
      if (event.key === "ArrowRight" || event.key === "Enter") {
        event.preventDefault();
        if (studyIndex() < BANK.length - 1) moveStudy(studyIndex() + 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (studyIndex() > 0) moveStudy(studyIndex() - 1);
      } else if (event.key.toLowerCase() === "b") {
        toggleBookmark(q.id);
      }
      return;
    }
    if (ui.view === "bookmarks") {
      const ids = bookmarkIds();
      if (event.key === "ArrowRight" || event.key === "Enter") {
        event.preventDefault();
        if (ui.bookmarkIndex < ids.length - 1) moveBookmark(ui.bookmarkIndex + 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (ui.bookmarkIndex > 0) moveBookmark(ui.bookmarkIndex - 1);
      } else if (event.key.toLowerCase() === "b") {
        toggleBookmark(q.id);
      }
      return;
    }
    if (/^[1-5]$/.test(event.key)) {
      const choice = q.choices[Number(event.key) - 1];
      if (choice) pick(choice.key);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (ui.view === "exam") {
        if (store.exam && store.exam.index < store.exam.questionIds.length - 1) {
          store.exam.index += 1;
          save();
          render();
        }
      } else if (store.practice) {
        if (!store.practice.revealed[q.id]) gradeCurrent();
        else if (store.practice.index < store.practice.ids.length - 1) {
          store.practice.index += 1;
          save();
          render();
        } else finishPractice(true);
      }
    } else if (event.key.toLowerCase() === "b") {
      toggleBookmark(q.id);
    } else if (event.key.toLowerCase() === "f" && ui.view === "exam" && store.exam) {
      const id = q.id;
      store.exam.flags = store.exam.flags.includes(id)
        ? store.exam.flags.filter((item) => item !== id)
        : store.exam.flags.concat(id);
      save();
      render();
    }
  });

  document.getElementById("lightbox").addEventListener("click", (event) => {
    if (event.target.id === "lightbox") document.getElementById("lightbox").hidden = true;
  });

  timerHandle = setInterval(() => {
    if (!store.exam || !store.exam.deadline) return;
    const remain = store.exam.deadline - Date.now();
    const timer = document.getElementById("timer");
    if (timer) {
      timer.textContent = formatClock(remain);
      timer.classList.toggle("low", remain < 5 * 60 * 1000);
    }
    if (remain <= 0) submitExam(true);
  }, 500);

  render();
})();
