/* AI 训练师题库 - H5 答题应用 */
(function () {
  'use strict';

  // ---------- 常量 ----------
  const DATA_DIR = 'data';
  const CAT_FILE = DATA_DIR + '/categories.json';
  const STORE_KEYS = { wrong: 'atq_wrong', known: 'atq_known', stats: 'atq_stats' };
  const QTYPE = { 1: '单选', 2: '多选', 3: '判断', 4: '简答' };
  const QTYPE_TAG = { 1: 'single', 2: 'multi', 3: 'judge', 4: 'essay' };

  // ---------- 状态 ----------
  let categoriesTree = null;        // {total, categories:[...]}
  let questionCache = {};           // catId -> [questions]
  let view = 'home';                // home | wrong | known | stats | quiz | category
  let navPath = [];                 // 分类导航栈：[{id,name,node}]
  let quiz = null;                  // 答题会话

  // ---------- 存储 ----------
  function loadJSON(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function saveJSON(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

  function getWrong() { return loadJSON(STORE_KEYS.wrong, {}); }
  function getKnown() { return loadJSON(STORE_KEYS.known, {}); }
  function getStats() { return loadJSON(STORE_KEYS.stats, { answered: 0, correct: 0 }); }

  function setWrong(num, count) {
    const w = getWrong();
    if (count <= 0) delete w[num]; else w[num] = count;
    saveJSON(STORE_KEYS.wrong, w);
  }
  function setKnown(num, val) {
    const k = getKnown();
    if (val) k[num] = 1; else delete k[num];
    saveJSON(STORE_KEYS.known, k);
  }
  function bumpStat(catId, correct) {
    const s = getStats();
    s.answered = (s.answered || 0) + 1;
    if (correct) s.correct = (s.correct || 0) + 1;
    if (!s.byCat) s.byCat = {};
    if (!s.byCat[catId]) s.byCat[catId] = { answered: 0, correct: 0 };
    s.byCat[catId].answered++;
    if (correct) s.byCat[catId].correct++;
    saveJSON(STORE_KEYS.stats, s);
  }

  // ---------- DOM ----------
  const $content = document.getElementById('content');
  const $title = document.getElementById('title');
  const $backBtn = document.getElementById('backBtn');
  const $menuBtn = document.getElementById('menuBtn');
  const $tabs = document.querySelectorAll('.tab');
  const $wrongBadge = document.getElementById('wrongBadge');

  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // ---------- 数据加载 ----------
  async function loadCategories() {
    const r = await fetch(CAT_FILE);
    categoriesTree = await r.json();
  }
  async function loadQuestions(catId) {
    if (questionCache[catId]) return questionCache[catId];
    const r = await fetch(DATA_DIR + '/q_' + catId + '.json');
    const qs = await r.json();
    questionCache[catId] = qs;
    return qs;
  }

  // 找到当前分类节点下的所有题目 id 范围
  function currentCategoryNode() {
    // navPath 最后一个节点
    return navPath[navPath.length - 1] || null;
  }
  function categoryLeafInfo() {
    // 返回 {catId, sub, sub2} 依据 navPath
    let catId = null, sub = null, sub2 = null;
    if (navPath.length >= 1) catId = navPath[0].id;
    if (navPath.length >= 2) sub = navPath[1].name;
    if (navPath.length >= 3) sub2 = navPath[2].name;
    return { catId, sub, sub2 };
  }

  // ---------- 渲染 ----------
  function render() {
    $backBtn.classList.toggle('hidden', view === 'home' || view === 'wrong' || view === 'known' || view === 'stats');
    const titles = { home: 'AI 训练师题库', wrong: '错题本', known: '已会题目', stats: '学习统计', category: '选择分类', quiz: '答题练习' };
    $title.textContent = titles[view] || 'AI 训练师题库';
    setActiveTab();
    updateBadge();
    if (view === 'home') renderHome();
    else if (view === 'wrong') renderWrong();
    else if (view === 'known') renderKnown();
    else if (view === 'stats') renderStats();
    else if (view === 'category') renderCategory();
    else if (view === 'quiz') renderQuiz();
    $content.scrollTop = 0;
  }

  function setActiveTab() {
    $tabs.forEach(t => {
      const v = t.dataset.view;
      t.classList.toggle('active', v === view || (view === 'category' && v === 'home') || (view === 'quiz' && v === 'home'));
    });
  }
  function updateBadge() {
    const n = Object.keys(getWrong()).length;
    $wrongBadge.textContent = n;
    $wrongBadge.classList.toggle('hidden', n === 0);
  }

  // ---------- 首页 ----------
  function renderHome() {
    const w = getWrong(), k = getKnown(), s = getStats();
    let html = '';
    html += '<div class="grid-2">'
      + statCard('总题数', categoriesTree ? categoriesTree.total : '-', 'blue')
      + statCard('已会', Object.keys(k).length, 'green')
      + statCard('错题', Object.keys(w).length, 'red')
      + statCard('累计作答', s.answered || 0, 'amber')
      + '</div>';

    html += '<div class="section-title">按分类学习</div>';
    (categoriesTree ? categoriesTree.categories : []).forEach(c => {
      html += '<div class="list-item" data-cat="' + esc(c.id) + '">'
        + '<div class="li-left"><div class="li-title">' + esc(c.name) + '</div>'
        + '<div class="li-sub">' + c.count + ' 题' + catProgress(c) + '</div></div>'
        + '<span class="chevron">›</span></div>';
    });

    html += '<div class="section-title">快速练习</div>';
    html += '<button class="btn ghost" id="randomBtn" style="margin-bottom:10px">🎲 随机练习 20 题</button>';

    $content.innerHTML = html;

    $content.querySelectorAll('[data-cat]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.cat;
        const node = findNode(id);
        openCategory(node);
      });
    });
    const rbtn = document.getElementById('randomBtn');
    if (rbtn) rbtn.addEventListener('click', startRandomQuiz);
  }

  function findNode(id) {
    for (const c of categoriesTree.categories) {
      if (c.id === id) return c;
      for (const s of (c.children || [])) {
        if (s.id === id) return s;
        for (const s2 of (s.children || [])) if (s2.id === id) return s2;
      }
    }
    return null;
  }
  function catProgress(c) {
    const s = getStats();
    const by = (s.byCat && s.byCat[c.id]) ? s.byCat[c.id] : null;
    if (!by) return '';
    const pct = c.count ? Math.round(by.answered / c.count * 100) : 0;
    return ' · 已做 ' + by.answered + ' (' + pct + '%)';
  }

  function statCard(lbl, num, color) {
    return '<div class="stat-card ' + color + '"><div class="num">' + num + '</div><div class="lbl">' + lbl + '</div></div>';
  }

  // ---------- 分类导航 ----------
  function openCategory(node) {
    navPath = [{ id: node.id, name: node.name, node: node }];
    if (node.children && node.children.length) {
      view = 'category'; render();
    } else {
      view = 'category'; render();
    }
  }
  function drillInto(node) {
    navPath.push({ id: node.id, name: node.name, node: node });
    if (node.children && node.children.length) {
      render();
    } else {
      // 叶子 -> 进入练习设置
      startQuizForLeaf();
    }
  }

  function renderCategory() {
    const node = currentCategoryNode().node;
    const crumbs = navPath.map(n => n.name).join(' / ');
    let html = '<div class="muted" style="margin-bottom:10px">' + esc(crumbs) + '</div>';
    if (node.children && node.children.length) {
      (node.children || []).forEach(ch => {
        html += '<div class="list-item" data-id="' + esc(ch.id) + '">'
          + '<div class="li-left"><div class="li-title">' + esc(ch.name) + '</div>'
          + '<div class="li-sub">' + ch.count + ' 题</div></div>'
          + '<span class="chevron">›</span></div>';
      });
      html += '<button class="btn secondary" id="drillAll" style="margin-top:6px">练习当前分类全部 ' + node.count + ' 题</button>';
    } else {
      html += '<button class="btn" id="leafStart">开始练习（' + node.count + ' 题）</button>';
    }
    $content.innerHTML = html;

    $content.querySelectorAll('[data-id]').forEach(el => {
      el.addEventListener('click', () => drillInto(findNode(el.dataset.id)));
    });
    const all = document.getElementById('drillAll');
    if (all) all.addEventListener('click', () => startQuizForLeaf(true));
    const leaf = document.getElementById('leafStart');
    if (leaf) leaf.addEventListener('click', () => startQuizForLeaf());
  }

  // ---------- 练习设置 ----------
  function startQuizForLeaf(useParentCount) {
    const info = categoryLeafInfo();
    showQuizSettings(info);
  }

  function showQuizSettings(info) {
    view = 'quiz';
    $title.textContent = '练习设置';
    let node = currentCategoryNode().node;
    const total = node.count;
    const known = getKnown(), wrong = getWrong();

    // 统计该分类下未做/错题数（粗略：用全局；精确需加载题目）
    let html = '<div class="card"><div class="li-title" style="margin-bottom:12px">' + esc(node.name) + '（' + total + ' 题）</div>';
    html += '<div class="muted" style="margin-bottom:8px">题目范围</div>';
    html += '<div class="chips" id="filterChips">'
      + chip('all', '全部 ' + total, true)
      + chip('wrong', '错题')
      + chip('undone', '未做')
      + chip('unlearned', '未会')
      + '</div>';
    html += '<div class="muted" style="margin-bottom:8px">顺序</div>';
    html += '<div class="chips" id="orderChips">'
      + chip('seq', '顺序', true)
      + chip('rand', '随机')
      + '</div>';
    html += '<div class="muted" style="margin-bottom:8px">题目数量</div>';
    html += '<div class="chips" id="countChips">'
      + chip('all', '全部', true)
      + chip('20', '20 题')
      + chip('50', '50 题')
      + chip('100', '100 题')
      + '</div>';
    html += '<button class="btn" id="startBtn" style="margin-top:16px">开始练习</button>';
    html += '</div>';
    $content.innerHTML = html;

    let filter = 'all', order = 'seq', count = 'all';
    bindChips('filterChips', v => filter = v);
    bindChips('orderChips', v => order = v);
    bindChips('countChips', v => count = v);

    document.getElementById('startBtn').addEventListener('click', async () => {
      await beginQuiz(info, filter, order, count);
    });
  }

  function chip(val, label, active) {
    return '<span class="chip' + (active ? ' active' : '') + '" data-v="' + val + '">' + label + '</span>';
  }
  function bindChips(containerId, cb) {
    const c = document.getElementById(containerId);
    c.querySelectorAll('.chip').forEach(ch => {
      ch.addEventListener('click', () => {
        c.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
        ch.classList.add('active');
        cb(ch.dataset.v);
      });
    });
  }

  async function beginQuiz(info, filter, order, count) {
    const qs = await loadQuestions(info.catId);
    let pool = qs;
    if (info.sub) pool = pool.filter(q => q.sub === info.sub);
    if (info.sub2) pool = pool.filter(q => q.sub2 === info.sub2);

    const wrong = getWrong(), known = getKnown();
    if (filter === 'wrong') pool = pool.filter(q => wrong[q.n]);
    else if (filter === 'undone') pool = pool.filter(q => !known[q.n] && !wrong[q.n]);
    else if (filter === 'unlearned') pool = pool.filter(q => !known[q.n]);

    if (order === 'rand') pool = shuffle(pool);
    if (count !== 'all') pool = pool.slice(0, parseInt(count));

    if (pool.length === 0) {
      $content.innerHTML = '<div class="empty"><div class="emoji">🎉</div>该范围暂无题目</div>';
      return;
    }
    startQuizSession(pool, info.catId);
  }

  function startRandomQuiz() {
    (async () => {
      $content.innerHTML = '<div class="empty"><div class="emoji">⏳</div>加载中…</div>';
      let all = [];
      for (const c of categoriesTree.categories) {
        try { all = all.concat(await loadQuestions(c.id)); } catch (e) {}
      }
      const pool = shuffle(all).slice(0, 20);
      startQuizSession(pool, 'mixed');
    })();
  }

  // ---------- 答题会话 ----------
  function startQuizSession(pool, catId) {
    quiz = {
      pool: pool,
      index: 0,
      catId: catId,
      results: [],   // 每题记录 {num, correct}
      selected: new Set(), // 多选已选
      answered: false,
    };
    view = 'quiz';
    render();
  }

  function renderQuiz() {
    const q = quiz.pool[quiz.index];
    if (!q) { finishQuiz(); return; }
    quiz.selected = new Set();
    quiz.answered = false;

    let html = '';
    html += '<div class="quiz-top">'
      + '<span class="tag ' + QTYPE_TAG[q.t] + '">' + QTYPE[q.t] + '</span>'
      + '<span class="progress-text">' + (quiz.index + 1) + ' / ' + quiz.pool.length + '</span>'
      + '</div>';
    html += '<div class="progress-bar"><div class="fill" style="width:' + ((quiz.index) / quiz.pool.length * 100) + '%"></div></div>';
    html += '<div class="card">';
    html += '<div class="q-stem">' + (q.t === 4 ? '[简答题] ' : '') + esc(q.s) + '</div>';

    const opts = normalizeOptions(q);
    if (q.t === 3) {
      html += '<div class="option" data-l="正确"><span class="opt-key">✓</span><span class="opt-text">正确</span></div>';
      html += '<div class="option" data-l="错误"><span class="opt-key">✗</span><span class="opt-text">错误</span></div>';
    } else if (q.t === 4) {
      html += '<div class="muted" style="margin:8px 0 16px">简答题无标准选项，请自行作答后自我评估。</div>';
    } else {
      opts.forEach(o => {
        html += '<div class="option" data-l="' + esc(o[0]) + '"><span class="opt-key">' + esc(o[0]) + '</span><span class="opt-text">' + esc(o[1]) + '</span></div>';
      });
    }
    html += '</div>';

    if (q.t === 2) {
      html += '<button class="btn" id="submitBtn">确认答案</button>';
    } else if (q.t === 4) {
      html += '<div class="grid-2" style="margin-top:8px">'
        + '<button class="btn" id="essayRight" style="background:var(--green)">我答对了</button>'
        + '<button class="btn" id="essayWrong" style="background:var(--red)">我答错了</button>'
        + '</div>';
    }
    $content.innerHTML = html;

    // 绑定选项点击
    const optionEls = $content.querySelectorAll('.option');
    if (q.t === 1 || q.t === 3) {
      optionEls.forEach(el => el.addEventListener('click', () => {
        if (quiz.answered) return;
        selectSingle(el.dataset.l);
      }));
    } else if (q.t === 2) {
      optionEls.forEach(el => el.addEventListener('click', () => {
        if (quiz.answered) return;
        el.classList.toggle('selected');
        const l = el.dataset.l;
        if (quiz.selected.has(l)) quiz.selected.delete(l); else quiz.selected.add(l);
      }));
      document.getElementById('submitBtn').addEventListener('click', submitMulti);
    }
    if (q.t === 4) {
      document.getElementById('essayRight').addEventListener('click', () => gradeEssay(true));
      document.getElementById('essayWrong').addEventListener('click', () => gradeEssay(false));
    }
  }

  function normalizeOptions(q) {
    // options 是 [["A","text"],...]；判断题无选项时给默认
    if (q.o && q.o.length) return q.o;
    return [];
  }

  function parseAnswerLetters(q) {
    if (q.t === 3) return q.a === '正确' ? '正确' : '错误';
    // 单选/多选：a 形如 "B" 或 "B、C、D"
    return q.a.split('、').map(s => s.trim()).filter(Boolean);
  }

  function selectSingle(letter) {
    const q = quiz.pool[quiz.index];
    quiz.answered = true;
    const correct = (letter === q.a);
    quiz.results.push({ num: q.n, correct: correct });
    markResult(q, correct);
    showVerdict(q, correct, letter);
  }

  function submitMulti() {
    const q = quiz.pool[quiz.index];
    if (quiz.selected.size === 0) return;
    quiz.answered = true;
    const userSet = Array.from(quiz.selected).sort();
    const ansSet = q.a.split('、').map(s => s.trim()).filter(Boolean).sort();
    const correct = JSON.stringify(userSet) === JSON.stringify(ansSet);
    quiz.results.push({ num: q.n, correct: correct });
    markResult(q, correct);
    showVerdict(q, correct, null);
  }

  function gradeEssay(correct) {
    const q = quiz.pool[quiz.index];
    quiz.answered = true;
    quiz.results.push({ num: q.n, correct: correct });
    markResult(q, correct);
    showVerdict(q, correct, null);
  }

  function markResult(q, correct) {
    const num = q.n;
    bumpStat(q.c || quiz.catId, correct);
    if (correct) {
      setWrong(num, 0);
      setKnown(num, true);
    } else {
      const w = getWrong();
      setWrong(num, (w[num] || 0) + 1);
      setKnown(num, false);
    }
  }

  function showVerdict(q, correct, chosenLetter) {
    // 高亮选项
    const optionEls = $content.querySelectorAll('.option');
    const ansLetters = q.t === 3 ? [q.a] : parseAnswerLetters(q);

    optionEls.forEach(el => el.classList.add('disabled'));
    if (q.t === 3) {
      optionEls.forEach(el => {
        if (el.dataset.l === q.a) el.classList.add('correct');
        else if (el.dataset.l === chosenLetter && chosenLetter !== q.a) el.classList.add('wrong');
      });
    } else if (q.t === 2) {
      optionEls.forEach(el => {
        const l = el.dataset.l;
        if (ansLetters.includes(l)) el.classList.add('correct');
        else if (quiz.selected.has(l)) el.classList.add('wrong');
      });
    } else {
      optionEls.forEach(el => {
        if (el.dataset.l === q.a) el.classList.add('correct');
        else if (el.dataset.l === chosenLetter) el.classList.add('wrong');
      });
    }

    // 判定提示 + 下一题按钮
    let hint = '<div class="answer-hint ' + (correct ? 'right' : 'wrong') + '">'
      + (correct ? '✔ 回答正确' : '✘ 回答错误') + '</div>';
    if (q.t !== 4 && q.t !== 3) {
      hint += '<div class="muted">正确答案：' + esc(q.a) + '</div>';
    } else if (q.t === 3) {
      hint += '<div class="muted">正确答案：' + esc(q.a) + '</div>';
    }
    hint += '<button class="btn" id="nextBtn" style="margin-top:14px">'
      + ((quiz.index + 1) < quiz.pool.length ? '下一题' : '查看结果') + '</button>';

    // 插入提示（替换提交按钮区域）
    const submitBtn = document.getElementById('submitBtn');
    if (submitBtn) submitBtn.remove();
    $content.insertAdjacentHTML('beforeend', hint);

    const nextBtn = document.getElementById('nextBtn');
    nextBtn.addEventListener('click', () => {
      quiz.index++;
      renderQuiz();
    });
  }

  function finishQuiz() {
    const total = quiz.results.length;
    const correct = quiz.results.filter(r => r.correct).length;
    const wrong = total - correct;
    const acc = total ? Math.round(correct / total * 100) : 0;
    const wrongList = quiz.results.filter(r => !r.correct);

    let html = '<div class="card result-hero">'
      + '<div class="big">' + (acc >= 80 ? '🎉' : acc >= 60 ? '👍' : '💪') + '</div>'
      + '<div class="score">本次正确率</div>'
      + '<div style="font-size:42px;font-weight:800;color:var(--primary)">' + acc + '%</div>'
      + '<div class="muted">共 ' + total + ' 题 · 答对 ' + correct + ' · 答错 ' + wrong + '</div>'
      + '</div>';

    if (wrongList.length) {
      html += '<div class="card"><div class="li-title" style="margin-bottom:8px">本次错题（' + wrongList.length + '）</div>';
      wrongList.forEach(r => {
        const q = findQuestionByNum(r.num);
        if (q) html += '<div class="muted" style="padding:6px 0;border-bottom:1px solid var(--border)">'
          + '<b>' + q.n + '.</b> ' + esc(q.s.length > 42 ? q.s.slice(0, 42) + '…' : q.s) + '</div>';
      });
      html += '</div>';
    }

    html += '<button class="btn secondary" id="againWrong" style="margin-bottom:10px">重做错题</button>';
    html += '<button class="btn" id="backHome">返回首页</button>';
    $content.innerHTML = html;

    document.getElementById('backHome').addEventListener('click', () => { view = 'home'; navPath = []; render(); });
    const aw = document.getElementById('againWrong');
    if (aw && wrongList.length) aw.addEventListener('click', () => {
      const pool = wrongList.map(r => findQuestionByNum(r.num)).filter(Boolean);
      startQuizSession(pool, quiz.catId);
    });
    quiz = null;
  }

  function findQuestionByNum(num) {
    for (const catId in questionCache) {
      const q = questionCache[catId].find(x => x.n === num);
      if (q) return q;
    }
    return null;
  }

  // ---------- 错题本 / 已会 ----------
  function renderWrong() {
    const wrong = getWrong();
    const nums = Object.keys(wrong).map(Number);
    if (nums.length === 0) { $content.innerHTML = emptyHtml('📭', '暂无错题'); return; }
    $content.innerHTML = '<div class="empty"><div class="emoji">⏳</div>加载中…</div>';
    resolveNumbers(nums).then(pool => {
      const byNum = {};
      pool.forEach(q => byNum[q.n] = q);
      let html = '<div class="section-title">共 ' + nums.length + ' 道错题</div>';
      html += '<button class="btn" id="redoAll" style="margin-bottom:14px">重做全部错题</button>';
      nums.forEach(num => {
        const q = byNum[num];
        const wc = wrong[num];
        html += '<div class="list-item" data-n="' + num + '">'
          + '<div class="li-left"><div class="li-title">' + esc(shortStem(q)) + '</div>'
          + '<div class="li-sub">' + (q ? '#' + num + ' · ' + QTYPE[q.t] : '#' + num) + ' · 错 ' + wc + ' 次</div></div>'
          + '<span class="chevron">›</span></div>';
      });
      $content.innerHTML = html;
      $content.querySelectorAll('[data-n]').forEach(el => {
        el.addEventListener('click', () => viewQuestion(parseInt(el.dataset.n)));
      });
      document.getElementById('redoAll').addEventListener('click', () => startQuizSession(pool, 'mixed'));
    });
  }

  function renderKnown() {
    const known = getKnown();
    const nums = Object.keys(known).map(Number);
    if (nums.length === 0) { $content.innerHTML = emptyHtml('🌟', '还没有已会题目，快去练习吧'); return; }
    $content.innerHTML = '<div class="empty"><div class="emoji">⏳</div>加载中…</div>';
    resolveNumbers(nums).then(pool => {
      const byNum = {};
      pool.forEach(q => byNum[q.n] = q);
      let html = '<div class="section-title">共掌握 ' + nums.length + ' 道题</div>';
      nums.forEach(num => {
        const q = byNum[num];
        html += '<div class="list-item" data-n="' + num + '">'
          + '<div class="li-left"><div class="li-title">' + esc(shortStem(q)) + '</div>'
          + '<div class="li-sub">' + (q ? '#' + num + ' · ' + QTYPE[q.t] : '#' + num) + '</div></div>'
          + '<span class="chevron">›</span></div>';
      });
      $content.innerHTML = html;
      $content.querySelectorAll('[data-n]').forEach(el => {
        el.addEventListener('click', () => viewQuestion(parseInt(el.dataset.n)));
      });
    });
  }

  function findLoadedQuestion(num) {
    for (const catId in questionCache) {
      const q = questionCache[catId].find(x => x.n === num);
      if (q) return q;
    }
    return null;
  }
  async function resolveNumbers(nums) {
    const catIds = categoriesTree.categories.map(c => c.id);
    for (const id of catIds) {
      if (!questionCache[id]) { try { await loadQuestions(id); } catch (e) {} }
    }
    return nums.map(n => findLoadedQuestion(n)).filter(Boolean);
  }
  function shortStem(q) {
    if (!q) return '（题目数据加载中…）';
    const s = q.s;
    return s.length > 40 ? s.slice(0, 40) + '…' : s;
  }

  // 查看单题（带答案回顾）
  function viewQuestion(num) {
    const q = findLoadedQuestion(num);
    if (!q) return;
    let html = '<div class="card">';
    html += '<div class="quiz-top"><span class="tag ' + QTYPE_TAG[q.t] + '">' + QTYPE[q.t] + '</span><span class="progress-text">#' + num + '</span></div>';
    html += '<div class="q-stem">' + esc(q.s) + '</div>';
    const opts = q.o || [];
    if (q.t === 3) {
      html += optionHtml('正确', q.a === '正确');
      html += optionHtml('错误', q.a === '错误');
    } else {
      opts.forEach(o => {
        const correct = (q.t === 4) ? false : q.a.split('、').includes(o[0]);
        html += '<div class="option disabled ' + (correct ? 'correct' : '') + '"><span class="opt-key">' + esc(o[0]) + '</span><span class="opt-text">' + esc(o[1]) + '</span></div>';
      });
    }
    if (q.t === 4) html += '<div class="muted" style="margin:8px 0">简答题</div>';
    html += '<div class="muted" style="margin-top:12px">答案：' + esc(q.a || '（无标准答案）') + '</div>';
    html += '</div>';
    html += '<button class="btn secondary" id="backBtn2">返回</button>';
    $content.innerHTML = html;
    document.getElementById('backBtn2').addEventListener('click', () => render());
  }
  function optionHtml(text, correct) {
    return '<div class="option disabled ' + (correct ? 'correct' : '') + '"><span class="opt-key">' + (correct ? '✓' : '·') + '</span><span class="opt-text">' + esc(text) + '</span></div>';
  }

  // ---------- 统计 ----------
  function renderStats() {
    const s = getStats();
    const w = getWrong(), k = getKnown();
    const acc = s.answered ? Math.round(s.correct / s.answered * 100) : 0;
    let html = '<div class="grid-2">'
      + statCard('累计作答', s.answered || 0, 'blue')
      + statCard('累计答对', s.correct || 0, 'green')
      + statCard('正确率', acc + '%', 'amber')
      + statCard('已掌握', Object.keys(k).length, 'blue')
      + '</div>';
    html += '<div class="card"><div class="li-title" style="margin-bottom:12px">各分类进度</div>';
    categoriesTree.categories.forEach(c => {
      const by = (s.byCat && s.byCat[c.id]) || { answered: 0, correct: 0 };
      const pct = c.count ? Math.round(by.answered / c.count * 100) : 0;
      html += '<div style="margin-bottom:12px">'
        + '<div style="display:flex;justify-content:space-between;font-size:14px"><span>' + esc(c.name) + '</span><span class="muted">' + by.answered + '/' + c.count + '</span></div>'
        + '<div class="progress-bar" style="margin:4px 0 0"><div class="fill" style="width:' + pct + '%"></div></div>'
        + '</div>';
    });
    html += '</div>';
    html += '<button class="btn ghost" id="resetBtn" style="color:var(--red)">清空所有学习记录</button>';
    $content.innerHTML = html;
    document.getElementById('resetBtn').addEventListener('click', () => {
      if (confirm('确定清空错题、已会和统计记录吗？此操作不可恢复。')) {
        localStorage.removeItem(STORE_KEYS.wrong);
        localStorage.removeItem(STORE_KEYS.known);
        localStorage.removeItem(STORE_KEYS.stats);
        render();
      }
    });
  }

  function emptyHtml(emoji, text) {
    return '<div class="empty"><div class="emoji">' + emoji + '</div>' + text + '</div>';
  }

  // ---------- 工具 ----------
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- 事件绑定 ----------
  $tabs.forEach(t => {
    t.addEventListener('click', () => {
      view = t.dataset.view;
      navPath = [];
      render();
    });
  });
  $backBtn.addEventListener('click', () => {
    if (view === 'quiz' && quiz) {
      // 答题中返回 -> 退出本次练习
      if (confirm('确定退出本次练习吗？进度将丢失。')) { quiz = null; view = 'home'; navPath = []; render(); }
      return;
    }
    if (view === 'category' || view === 'quiz') {
      if (navPath.length > 1) { navPath.pop(); render(); }
      else { view = 'home'; navPath = []; render(); }
      return;
    }
    view = 'home'; render();
  });

  // ---------- 启动 ----------
  (async function init() {
    await loadCategories();
    render();
  })();
})();
