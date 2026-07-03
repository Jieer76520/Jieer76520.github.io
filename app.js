(() => {
  const dataReady = window.PATHOLOGY_QUESTIONS_READY || Promise.resolve(window.PATHOLOGY_QUESTIONS);
  dataReady.then((DATA) => {
  const STORAGE_KEY = "pathology-a-type-state-v1";

  if (!DATA || !Array.isArray(DATA.questions)) {
    document.getElementById("app").innerHTML = '<div class="empty-state">題庫資料未載入，請確認 questions.js 是否存在。</div>';
    return;
  }

  const app = document.getElementById("app");
  const pageTitle = document.getElementById("pageTitle");
  const chapterNav = document.getElementById("chapterNav");
  const toast = document.getElementById("toast");
  const quickSearch = document.getElementById("quickSearch");
  const quickSearchInput = document.getElementById("quickSearchInput");

  const questions = DATA.questions;
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const chapters = DATA.meta.chapters.map((chapter) => ({
    ...chapter,
    questions: questions.filter((question) => question.chapterId === chapter.id),
  }));
  const chapterOrder = DATA.meta.chapterOrder;

  let state = loadState();
  let currentExam = null;
  let lastRouteView = "";
  const chapterCursor = {};
  const revealedAnswers = new Set();
  const wrongDrafts = {};

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => {
      const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
      return map[char];
    });
  }

  function loadState() {
    const fallback = { practice: {}, wrongBook: {}, lastExam: null, progressSummary: {} };
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return { ...fallback, ...parsed, practice: parsed.practice || {}, wrongBook: parsed.wrongBook || {} };
    } catch (_error) {
      return fallback;
    }
  }

  function saveState() {
    state.progressSummary = buildProgressSummary();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function buildProgressSummary() {
    return Object.fromEntries(
      chapters.map((chapter) => {
        const stats = getChapterStats(chapter.id);
        return [chapter.id, { done: stats.done, correct: stats.correct, rate: stats.rate }];
      }),
    );
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function parseRoute() {
    const raw = decodeURIComponent(location.hash.replace(/^#/, "")) || "home";
    const [view, param] = raw.split("/");
    return { view, param };
  }

  function setPageTitle(title) {
    pageTitle.textContent = title;
    document.title = `${title} | 病理學刷題`;
  }

  function renderNav(activeRoute) {
    chapterNav.innerHTML = chapters
      .map((chapter) => {
        const stats = getChapterStats(chapter.id);
        const shortTitle = chapter.title.replace(/^第.+?章\s*/, "");
        return `
          <a href="#chapter/${chapter.id}" data-nav="${chapter.id}">
            <strong>${escapeHtml(shortTitle)}</strong>
            <span>${stats.done}/${chapter.count}</span>
          </a>
        `;
      })
      .join("");

    document.querySelectorAll("[data-nav]").forEach((link) => link.classList.remove("active"));
    const activeKey = activeRoute.view === "chapter" ? activeRoute.param : activeRoute.view;
    document.querySelectorAll(`[data-nav="${activeKey}"]`).forEach((link) => link.classList.add("active"));
  }

  function render(options = {}) {
    const route = parseRoute();
    if (route.view === "exam" && lastRouteView !== "exam") {
      currentExam = createExam();
    }

    const useTransition = Boolean(options.transition);
    const applyRender = () => {
      app.dataset.motion = useTransition ? "switch" : "none";
      renderNav(route);

      if (route.view === "chapter") {
        renderChapter(route.param);
      } else if (route.view === "exam") {
        renderExam();
      } else if (route.view === "wrong") {
        renderWrongBook();
      } else if (route.view === "search") {
        renderSearch();
      } else {
        renderHome();
      }

      lastRouteView = route.view;
    };

    applyRender();
  }

  function getChapterStats(chapterId) {
    const chapterQuestions = questions.filter((question) => question.chapterId === chapterId);
    const records = chapterQuestions.map((question) => state.practice[question.id]).filter(Boolean);
    const correct = records.filter((record) => record.correct).length;
    const done = records.length;
    return {
      total: chapterQuestions.length,
      done,
      correct,
      rate: done ? Math.round((correct / done) * 100) : 0,
    };
  }

  function formatAnswer(q, answer) {
    if (!answer) return "未作答";
    return `${answer}. ${q.options[answer] || ""}`;
  }

  function getRevealKey(mode, questionId) {
    return mode === "wrong" ? `wrong:${questionId}` : questionId;
  }

  function displayExplanation(q) {
    return String(q.explanation || "")
      .replace(/^白皮答案[為为]\s*([A-E])（([^）]+)）。\s*/, "正確答案為 $1（$2）。")
      .replace(/^考試指南答案[為为]\s*([A-E])（([^）]+)）。\s*/, "正確答案為 $1（$2）。")
      .replace(/^答案[為为]\s*([A-E])（([^）]+)）。\s*/, "正確答案為 $1（$2）。")
      .replace(/(?:來源|sourcePage)[：:][\s\S]*$/i, "")
      .trim();
  }

  function renderHome() {
    setPageTitle(DATA.meta.title);
    const totalDone = Object.keys(state.practice).length;
    const totalCorrect = Object.values(state.practice).filter((record) => record.correct).length;
    const totalRate = totalDone ? Math.round((totalCorrect / totalDone) * 100) : 0;
    const wrongCount = Object.keys(state.wrongBook).length;
    const lastExam = state.lastExam
      ? `${state.lastExam.correct}/${state.lastExam.total}，${state.lastExam.rate}%`
      : "尚未提交";

    app.innerHTML = `
      <section class="intro">
        <div class="panel intro-copy">
          <h2>病理學期末 A 型題刷題系統</h2>
          <p>題目來自《病理學考試指南》A 型選擇題，已根據你提供的期末考試範圍篩選。教材僅作知識點對照，題庫不加入來源之外的自編題。</p>
          <div class="tools">
            <a class="button primary" href="#exam">開始 150 題模擬考</a>
            <a class="button" href="#wrong">查看錯題本</a>
            <a class="button" href="#search">搜索關鍵詞</a>
            <button type="button" data-action="reset-all-progress">重置全部進度</button>
            <button type="button" class="danger" data-action="clear-wrong-book">清空錯題本</button>
          </div>
        </div>
        <div class="panel">
          <div class="stat-grid">
            <div class="stat"><strong>${questions.length}</strong><span>已納入 A 型題</span></div>
            <div class="stat"><strong>${totalDone}</strong><span>已做題數</span></div>
            <div class="stat"><strong>${totalRate}%</strong><span>總正確率</span></div>
          </div>
          <p class="muted" style="margin:14px 0 0;">錯題本：${wrongCount} 題；最近一次模擬考：${escapeHtml(lastExam)}</p>
        </div>
      </section>

      <section class="chapter-grid">
        ${chapters.map(renderChapterCard).join("")}
      </section>
    `;
  }

  function renderChapterCard(chapter) {
    const stats = getChapterStats(chapter.id);
    const width = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
    return `
      <article class="chapter-card">
        <div>
          <h3>${escapeHtml(chapter.title)}</h3>
          <p>${chapter.count} 題；已做 ${stats.done} 題；正確率 ${stats.rate}%</p>
        </div>
        <div>
          <div class="meter" aria-label="本章進度"><span style="width:${width}%"></span></div>
          <div class="tools" style="margin-top:12px;">
            <a class="button primary" href="#chapter/${chapter.id}">進入刷題</a>
          </div>
        </div>
      </article>
    `;
  }

  function renderChapter(chapterId) {
    const chapter = chapters.find((item) => item.id === chapterId) || chapters[0];
    const list = chapter.questions;
    const currentIndex = Math.min(chapterCursor[chapter.id] || 0, list.length - 1);
    const question = list[currentIndex];
    const stats = getChapterStats(chapter.id);
    setPageTitle(chapter.title);

    app.innerHTML = `
      <section class="chapter-head">
        <div>
          <h2>${escapeHtml(chapter.title)}</h2>
          <p class="muted">本章 ${chapter.count} 題；已做 ${stats.done} 題；正確率 ${stats.rate}%。</p>
        </div>
        <div class="tools">
          <a class="button" href="#home">返回首頁</a>
          <a class="button" href="#search">搜索題目</a>
          <button type="button" data-action="reset-chapter" data-chapter-id="${chapter.id}">重置本章</button>
        </div>
      </section>

      <section class="question-layout">
        <aside class="question-list" aria-label="題目列表">
          ${list.map((item, index) => renderQuestionDot(item, index, currentIndex, chapter.id)).join("")}
        </aside>
        <div>
          ${renderQuestionCard(question, { mode: "practice", index: currentIndex, total: list.length })}
          ${renderChapterAnswerSummary(list)}
        </div>
      </section>
    `;
  }

  function renderQuestionDot(question, index, currentIndex, chapterId) {
    const record = state.practice[question.id];
    const classes = ["number-dot"];
    if (index === currentIndex) classes.push("active");
    if (record?.correct) classes.push("correct");
    if (record && !record.correct) classes.push("incorrect");
    return `<button class="${classes.join(" ")}" data-action="jump-question" data-chapter-id="${chapterId}" data-index="${index}" aria-label="第 ${index + 1} 題">${index + 1}</button>`;
  }

  function renderQuestionCard(q, config) {
    const { mode, index, total } = config;
    const isExam = mode === "exam";
    const isWrong = mode === "wrong";
    const submitted = Boolean(config.submitted);
    const practiceRecord = state.practice[q.id];
    const wrongEntry = config.wrongEntry || state.wrongBook[q.id];
    const selected = isExam
      ? currentExam.answers[q.id] || ""
      : isWrong
        ? wrongDrafts[q.id] || ""
        : practiceRecord?.selected || "";
    const showAnswer = isWrong
      ? revealedAnswers.has(getRevealKey("wrong", q.id))
      : submitted || revealedAnswers.has(getRevealKey(mode, q.id)) || Boolean(practiceRecord);
    const isWrongMarked = Boolean(state.wrongBook[q.id]);
    const correct = selected && selected === q.answer;
    const actions = isExam
      ? renderExamCardActions(q, submitted, isWrongMarked)
      : isWrong
        ? renderWrongPracticeActions(q, isWrongMarked)
        : renderPracticeActions(q, index, total, isWrongMarked);

    return `
      <article class="question-card" id="${escapeHtml(q.id)}" style="--card-index:${index % 8}">
        <div class="question-meta">
          <span class="tag">${index + 1}/${total}</span>
          <span class="tag">${escapeHtml(q.chapter)}</span>
          <span class="tag">${escapeHtml(q.section)}</span>
          <span class="tag">${escapeHtml(q.id)}</span>
        </div>
        <div class="question-text">${escapeHtml(q.question)}</div>
        <div class="options">
          ${"ABCDE"
            .split("")
            .map((label) => renderOption(q, label, { selected, showAnswer, submitted, mode }))
            .join("")}
        </div>
        ${actions}
        ${renderFeedback(q, { selected, showAnswer, isExam, submitted, practiceRecord, correct })}
        ${showAnswer ? renderAnswerBox(q) : ""}
      </article>
    `;
  }

  function renderOption(q, label, config) {
    const optionText = q.options[label] || "";
    const classes = ["option-row"];
    if (config.selected === label) classes.push("selected");
    if (config.showAnswer && label === q.answer) classes.push("correct");
    if (config.showAnswer && config.selected === label && label !== q.answer) classes.push("incorrect");
    const checked = config.selected === label ? "checked" : "";
    const disabled = config.submitted ? "disabled" : "";
    return `
      <label class="${classes.join(" ")}" style="--option-index:${"ABCDE".indexOf(label)}">
        <input type="radio" name="${config.mode}-${escapeHtml(q.id)}" value="${label}" data-context="${config.mode}" data-question-id="${escapeHtml(q.id)}" ${checked} ${disabled} />
        <span><strong>${label}.</strong> ${escapeHtml(optionText)}</span>
      </label>
    `;
  }

  function renderFeedback(q, config) {
    if (!config.showAnswer || (!config.selected && !config.submitted)) return "";
    const ok = config.selected === q.answer;
    if (ok) {
      return '<div class="feedback ok">回答正確。</div>';
    }
    return `<div class="feedback bad">回答錯誤。你的答案：${escapeHtml(formatAnswer(q, config.selected))}</div>`;
  }

  function renderAnswerBox(q) {
    return `
      <div class="answer-box">
        <div><strong>正確答案：</strong>${escapeHtml(formatAnswer(q, q.answer))}</div>
        <div><strong>解析：</strong>${escapeHtml(displayExplanation(q))}</div>
        ${q.corrected ? `<div><strong>修正：</strong>${escapeHtml(q.correctionNote)}</div>` : ""}
      </div>
    `;
  }

  function renderPracticeActions(q, index, total, isWrongMarked) {
    return `
      <div class="card-actions">
        <div class="primary-actions">
          <button data-action="prev-question" ${index === 0 ? "disabled" : ""}>上一題</button>
          <button class="primary" data-action="check-answer" data-question-id="${escapeHtml(q.id)}">判斷正誤</button>
          <button data-action="next-question" ${index === total - 1 ? "disabled" : ""}>下一題</button>
        </div>
        <div class="secondary-actions">
          <button data-action="reveal-answer" data-context="practice" data-question-id="${escapeHtml(q.id)}">顯示答案</button>
          <button data-action="toggle-wrong" data-question-id="${escapeHtml(q.id)}">${isWrongMarked ? "移出錯題本" : "加入錯題本"}</button>
        </div>
      </div>
    `;
  }

  function renderExamCardActions(q, submitted, isWrongMarked) {
    if (!submitted) return "";
    return `
      <div class="card-actions">
        <div class="secondary-actions">
          <button data-action="toggle-wrong" data-question-id="${escapeHtml(q.id)}">${isWrongMarked ? "移出錯題本" : "標記錯題"}</button>
        </div>
      </div>
    `;
  }

  function renderWrongPracticeActions(q, isWrongMarked) {
    return `
      <div class="card-actions">
        <div class="primary-actions">
          <button class="primary" data-action="check-wrong-answer" data-question-id="${escapeHtml(q.id)}">判斷正誤</button>
        </div>
        <div class="secondary-actions">
          <button data-action="reveal-answer" data-context="wrong" data-question-id="${escapeHtml(q.id)}">顯示答案</button>
          <button class="danger" data-action="remove-wrong" data-question-id="${escapeHtml(q.id)}">${isWrongMarked ? "移出錯題本" : "已移出"}</button>
        </div>
      </div>
    `;
  }

  function renderChapterAnswerSummary(list) {
    return `
      <details class="panel" style="margin-top:18px;">
        <summary>本章所有答案與解析匯總</summary>
        <div class="summary-list">
          ${list
            .map(
              (q, index) => `
                <div class="answer-box">
                  <strong>${index + 1}. ${escapeHtml(q.id)}：</strong>${escapeHtml(formatAnswer(q, q.answer))}
                  <div>${escapeHtml(displayExplanation(q))}</div>
                </div>
              `,
            )
            .join("")}
        </div>
      </details>
    `;
  }

  function createExam() {
    const selected = shuffle([...questions]).slice(0, Math.min(150, questions.length));
    const grouped = new Map(chapterOrder.map((chapterId) => [chapterId, []]));
    selected.forEach((question) => grouped.get(question.chapterId)?.push(question));
    const ordered = chapterOrder.flatMap((chapterId) => shuffle(grouped.get(chapterId) || []));
    return {
      ids: ordered.map((question) => question.id),
      answers: {},
      submitted: false,
      score: null,
      createdAt: new Date().toISOString(),
    };
  }

  function renderExam() {
    if (!currentExam) currentExam = createExam();
    setPageTitle("模擬考試");
    const answered = Object.keys(currentExam.answers).length;
    const total = currentExam.ids.length;
    const score = currentExam.score;
    const scoreHtml = score
      ? `
        <section class="exam-score">
          <div class="stat"><strong>${score.correct}</strong><span>正確題數</span></div>
          <div class="stat"><strong>${score.wrong}</strong><span>錯誤題數</span></div>
          <div class="stat"><strong>${score.rate}%</strong><span>得分率</span></div>
        </section>
      `
      : "";

    app.innerHTML = `
      <section class="exam-head">
        <div>
          <h2>150 題模擬考</h2>
          <p class="muted">從全部考試範圍題庫隨機抽取，整體按章節順序排列，章節內隨機打亂。已作答 <span id="examAnswered">${answered}</span>/${total} 題。</p>
        </div>
        <div class="tools">
          <button data-action="regenerate-exam">重新生成試卷</button>
          <button class="primary" data-action="submit-exam" ${currentExam.submitted ? "disabled" : ""}>提交試卷</button>
        </div>
      </section>
      ${scoreHtml}
      <section class="exam-list">
        ${currentExam.ids
          .map((id, index) => renderQuestionCard(questionById.get(id), { mode: "exam", index, total, submitted: currentExam.submitted }))
          .join("")}
      </section>
    `;
  }

  function submitExam() {
    if (!currentExam || currentExam.submitted) return;
    const total = currentExam.ids.length;
    const answered = Object.keys(currentExam.answers).length;
    const message =
      answered < total
        ? `還有 ${total - answered} 題未作答，未作答將按錯題計算。確定提交嗎？`
        : "確定提交本次試卷嗎？";
    if (!window.confirm(message)) return;

    let correct = 0;
    currentExam.ids.forEach((id) => {
      const question = questionById.get(id);
      const selected = currentExam.answers[id] || "";
      if (selected === question.answer) {
        correct += 1;
      } else {
        addWrong(question.id, selected || "未作答", "模擬考試");
      }
    });

    const wrong = total - correct;
    currentExam.submitted = true;
    currentExam.score = {
      total,
      correct,
      wrong,
      rate: Math.round((correct / total) * 100),
      submittedAt: new Date().toISOString(),
    };
    state.lastExam = { ...currentExam.score, questionIds: currentExam.ids };
    saveState();
    render();
    showToast("試卷已提交，錯題已加入錯題本。");
  }

  function renderWrongBook() {
    setPageTitle("錯題本");
    const entries = Object.values(state.wrongBook)
      .map((entry) => ({ ...entry, question: questionById.get(entry.questionId) }))
      .filter((entry) => entry.question)
      .sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));

    if (!entries.length) {
      app.innerHTML = `
        <section class="empty-state">
          <h2>錯題本目前是空的</h2>
          <p>分章刷題或模擬考答錯後，題目會自動加入這裡。答對錯題後會自動移出。</p>
        </section>
      `;
      return;
    }

    app.innerHTML = `
      <section class="chapter-head">
        <div>
          <h2>錯題本</h2>
          <p class="muted">共 ${entries.length} 題。直接在這裡重新作答：答錯會繼續保留，答對會自動移出。</p>
        </div>
        <div class="tools">
          <button class="danger" data-action="clear-wrong-book">清空錯題本</button>
        </div>
      </section>
      <section class="wrong-grid">
        ${entries.map((entry, index) => renderQuestionCard(entry.question, { mode: "wrong", index, total: entries.length, wrongEntry: entry })).join("")}
      </section>
    `;
  }

  function renderWrongCard(entry) {
    const q = entry.question;
    return `
      <article class="wrong-card">
        <div class="question-meta">
          <span class="tag">${escapeHtml(q.chapter)}</span>
          <span class="tag">${escapeHtml(q.section)}</span>
          <span class="tag">${escapeHtml(entry.source || "錯題")}</span>
        </div>
        <h3>${escapeHtml(q.question)}</h3>
        <p><strong>錯選答案：</strong>${escapeHtml(formatAnswer(q, entry.wrongAnswer))}</p>
        <p><strong>正確答案：</strong>${escapeHtml(formatAnswer(q, q.answer))}</p>
        <p><strong>解析：</strong>${escapeHtml(displayExplanation(q))}</p>
        <div class="tools">
          <a class="button" href="#chapter/${q.chapterId}">回到章節</a>
          <button class="danger" data-action="remove-wrong" data-question-id="${escapeHtml(q.id)}">移出錯題本</button>
        </div>
      </article>
    `;
  }

  function renderSearch() {
    setPageTitle("搜索題目");
    const query = state.searchQuery || "";
    const results = query ? searchQuestions(query) : [];

    app.innerHTML = `
      <section class="search-head">
        <div>
          <h2>搜索題目</h2>
          <p class="muted">可搜索疾病名稱、病理改變、章節或選項文字。</p>
        </div>
      </section>
      <form id="searchForm" class="search-box" role="search">
        <input id="searchInput" type="search" value="${escapeHtml(query)}" placeholder="例如：乾酪樣壞死、假小葉、霍奇金淋巴瘤、新月體" autofocus />
        <div class="tools">
          <button class="primary" type="submit">搜索</button>
          <button type="button" data-action="clear-search">清空</button>
        </div>
      </form>
      <section class="results">
        ${query ? `<p class="muted">找到 ${results.length} 題。</p>` : ""}
        ${query && !results.length ? '<div class="empty-state">沒有找到匹配題目。</div>' : results.map(renderSearchResult).join("")}
      </section>
    `;
  }

  function renderSearchResult(q) {
    return `
      <article class="result-card">
        <div class="question-meta">
          <span class="tag">${escapeHtml(q.chapter)}</span>
          <span class="tag">${escapeHtml(q.section)}</span>
          <span class="tag">${escapeHtml(q.id)}</span>
        </div>
        <h3>${escapeHtml(q.question)}</h3>
        <p><strong>答案：</strong>${escapeHtml(formatAnswer(q, q.answer))}</p>
        <p class="muted">${escapeHtml(displayExplanation(q))}</p>
        <div class="tools">
          <a class="button primary" href="#chapter/${q.chapterId}">去本章刷題</a>
          <button data-action="toggle-wrong" data-question-id="${escapeHtml(q.id)}">${state.wrongBook[q.id] ? "移出錯題本" : "加入錯題本"}</button>
        </div>
      </article>
    `;
  }

  function normalizeSearchText(text) {
    const variants = {
      乾: "干",
      樣: "样",
      壞: "坏",
      葉: "叶",
      體: "体",
      腎: "肾",
      臟: "脏",
      腫: "肿",
      瘤: "瘤",
      結: "结",
      傷: "伤",
      傳: "传",
      染: "染",
      類: "类",
      濕: "湿",
      動: "动",
      脈: "脉",
      纖: "纤",
      維: "维",
      膽: "胆",
      血: "血",
      栓: "栓",
      癒: "愈",
      膚: "肤",
      黏: "粘",
      腸: "肠",
      頸: "颈",
      髓: "髓",
      擴: "扩",
      散: "散",
      慢: "慢",
      性: "性",
      變: "变",
      錯: "错",
      題: "题",
      學: "学",
    };
    return String(text || "")
      .toLowerCase()
      .replace(/[乾樣壞葉體腎臟腫結傷傳類濕動脈纖維膽癒膚黏腸頸擴變錯題學]/g, (char) => variants[char] || char)
      .replace(/\s+/g, "");
  }

  function searchQuestions(query) {
    const normalizedQuery = normalizeSearchText(query);
    return questions.filter((q) => normalizeSearchText(searchCorpus(q)).includes(normalizedQuery));
  }

  function searchCorpus(q) {
    return [q.id, q.chapter, q.section, q.question, q.answer, q.explanation, ...Object.values(q.options)].join(" ");
  }

  function jumpQuestion(chapterId, index) {
    chapterCursor[chapterId] = Number(index);
    render({ transition: true });
  }

  function moveQuestion(direction) {
    const route = parseRoute();
    if (route.view !== "chapter") return;
    const chapter = chapters.find((item) => item.id === route.param);
    if (!chapter) return;
    const current = chapterCursor[chapter.id] || 0;
    chapterCursor[chapter.id] = Math.max(0, Math.min(chapter.questions.length - 1, current + direction));
    render({ transition: true });
  }

  function getSelectedAnswer(context, questionId) {
    const inputs = Array.from(app.querySelectorAll(`input[type="radio"][data-context="${context}"]`));
    return inputs.find((input) => input.dataset.questionId === questionId && input.checked)?.value || "";
  }

  function checkPracticeAnswer(questionId) {
    const question = questionById.get(questionId);
    const selected = getSelectedAnswer("practice", questionId);
    if (!selected) {
      showToast("請先選擇一個答案。");
      return;
    }
    const correct = selected === question.answer;
    state.practice[questionId] = {
      selected,
      correct,
      answeredAt: new Date().toISOString(),
    };
    if (!correct) addWrong(questionId, selected, "分章刷題");
    revealedAnswers.add(getRevealKey("practice", questionId));
    saveState();
    render();
    showToast(correct ? "回答正確。" : "回答錯誤，已加入錯題本。");
  }

  function addWrong(questionId, wrongAnswer, source) {
    delete wrongDrafts[questionId];
    revealedAnswers.delete(getRevealKey("wrong", questionId));
    state.wrongBook[questionId] = {
      ...state.wrongBook[questionId],
      questionId,
      wrongAnswer: wrongAnswer || "手動標記",
      source,
      addedAt: new Date().toISOString(),
    };
  }

  function resetChapter(chapterId) {
    const chapter = chapters.find((item) => item.id === chapterId);
    if (!chapter) return;
    if (!window.confirm(`確定重置「${chapter.title}」的做題記錄嗎？錯題本不會被清空。`)) return;
    chapter.questions.forEach((question) => {
      delete state.practice[question.id];
      revealedAnswers.delete(getRevealKey("practice", question.id));
    });
    saveState();
    render();
    showToast("本章進度已重置。");
  }

  function resetAllProgress() {
    if (!window.confirm("確定重置全部分章做題記錄和最近一次模擬考成績嗎？錯題本不會被清空。")) return;
    state.practice = {};
    state.lastExam = null;
    currentExam = null;
    revealedAnswers.clear();
    saveState();
    render();
    showToast("全部進度已重置。");
  }

  function clearWrongBook() {
    if (!window.confirm("確定清空錯題本嗎？這個操作不能撤回。")) return;
    state.wrongBook = {};
    Object.keys(wrongDrafts).forEach((id) => delete wrongDrafts[id]);
    saveState();
    render();
    showToast("錯題本已清空。");
  }

  function checkWrongAnswer(questionId) {
    const question = questionById.get(questionId);
    const selected = getSelectedAnswer("wrong", questionId);
    if (!selected) {
      showToast("請先選擇一個答案。");
      return;
    }
    if (selected === question.answer) {
      delete state.wrongBook[questionId];
      delete wrongDrafts[questionId];
      revealedAnswers.delete(getRevealKey("wrong", questionId));
      saveState();
      render();
      showToast("這題答對了，已移出錯題本。");
      return;
    }
    wrongDrafts[questionId] = selected;
    state.wrongBook[questionId] = {
      ...state.wrongBook[questionId],
      questionId,
      wrongAnswer: selected,
      attempts: (state.wrongBook[questionId]?.attempts || 0) + 1,
      lastTriedAt: new Date().toISOString(),
    };
    revealedAnswers.add(getRevealKey("wrong", questionId));
    saveState();
    render();
    showToast("仍然答錯，這題會繼續留在錯題本。");
  }

  function toggleWrong(questionId) {
    if (state.wrongBook[questionId]) {
      delete state.wrongBook[questionId];
      delete wrongDrafts[questionId];
      revealedAnswers.delete(getRevealKey("wrong", questionId));
      saveState();
      render();
      showToast("已移出錯題本。");
      return;
    }
    const selected =
      getSelectedAnswer("practice", questionId) ||
      currentExam?.answers?.[questionId] ||
      state.practice[questionId]?.selected ||
      "手動標記";
    addWrong(questionId, selected, "手動標記");
    saveState();
    render();
    showToast("已加入錯題本。");
  }

  function shuffle(items) {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function handleClick(event) {
    const target = event.target.closest("[data-action]");
    if (!target) return;

    const action = target.dataset.action;
    if (action === "jump-question") jumpQuestion(target.dataset.chapterId, target.dataset.index);
    if (action === "prev-question") moveQuestion(-1);
    if (action === "next-question") moveQuestion(1);
    if (action === "check-answer") checkPracticeAnswer(target.dataset.questionId);
    if (action === "check-wrong-answer") checkWrongAnswer(target.dataset.questionId);
    if (action === "reveal-answer") {
      revealedAnswers.add(getRevealKey(target.dataset.context, target.dataset.questionId));
      render();
    }
    if (action === "toggle-wrong") toggleWrong(target.dataset.questionId);
    if (action === "remove-wrong") {
      delete state.wrongBook[target.dataset.questionId];
      delete wrongDrafts[target.dataset.questionId];
      revealedAnswers.delete(getRevealKey("wrong", target.dataset.questionId));
      saveState();
      render();
      showToast("已移出錯題本。");
    }
    if (action === "regenerate-exam") {
      if (!currentExam?.submitted && Object.keys(currentExam?.answers || {}).length) {
        if (!window.confirm("重新生成會清空目前這份試卷的作答，確定嗎？")) return;
      }
      currentExam = createExam();
      render();
      showToast("已重新生成試卷。");
    }
    if (action === "submit-exam") submitExam();
    if (action === "reset-chapter") resetChapter(target.dataset.chapterId);
    if (action === "reset-all-progress") resetAllProgress();
    if (action === "clear-wrong-book") clearWrongBook();
    if (action === "clear-search") {
      state.searchQuery = "";
      render();
    }
  }

  function handleChange(event) {
    const input = event.target.closest('input[type="radio"]');
    if (!input) return;
    if (input.dataset.context === "wrong") {
      const entry = state.wrongBook[input.dataset.questionId];
      if (entry) {
        wrongDrafts[input.dataset.questionId] = input.value;
        revealedAnswers.delete(getRevealKey("wrong", input.dataset.questionId));
        saveState();
        render();
      }
      return;
    }
    if (input.dataset.context !== "exam" || !currentExam || currentExam.submitted) return;
    currentExam.answers[input.dataset.questionId] = input.value;
    const answeredLabel = document.getElementById("examAnswered");
    if (answeredLabel) answeredLabel.textContent = Object.keys(currentExam.answers).length;
  }

  function handleSubmit(event) {
    if (event.target.id !== "searchForm") return;
    event.preventDefault();
    const input = document.getElementById("searchInput");
    state.searchQuery = input?.value.trim() || "";
    render();
  }

  quickSearch.addEventListener("submit", (event) => {
    event.preventDefault();
    state.searchQuery = quickSearchInput.value.trim();
    location.hash = "search";
    render({ transition: true });
  });

  app.addEventListener("click", handleClick);
  app.addEventListener("change", handleChange);
  app.addEventListener("submit", handleSubmit);
  window.addEventListener("hashchange", () => render({ transition: true }));

  saveState();
  render();
  }).catch(() => {
    document.getElementById("app").innerHTML = '<div class="empty-state">題庫載入失敗，請重新整理頁面。</div>';
  });
})();
