/* TikTok コメント読み上げ — フロントエンドロジック
 *
 * 構成:
 *  - TikTok LIVE のコメントは「中継サーバー(Socket.IO)」経由で受信する
 *    （ブラウザから TikTok へ直接接続できないため）。
 *  - 受信したコメントを Web Speech API (speechSynthesis) で日本語読み上げ。
 *  - 設定は localStorage に保存。
 */
(() => {
  'use strict';

  const DEFAULT_SERVER = 'https://tiktok-chat-reader.zerody.one/';
  const STORE_KEY = 'ttcomment.settings.v1';

  // ---- DOM ----
  const $ = (id) => document.getElementById(id);
  const el = {
    status: $('status'), statusText: $('statusText'),
    speakToggle: $('speakToggle'), speakIcon: $('speakIcon'), speakLabel: $('speakLabel'),
    username: $('username'), connectBtn: $('connectBtn'), disconnectBtn: $('disconnectBtn'),
    demoBtn: $('demoBtn'),
    feed: $('feed'), queueInfo: $('queueInfo'),
    voice: $('voice'),
    rate: $('rate'), rateOut: $('rateOut'),
    pitch: $('pitch'), pitchOut: $('pitchOut'),
    volume: $('volume'), volumeOut: $('volumeOut'),
    readName: $('readName'), stripEmoji: $('stripEmoji'),
    skipUrl: $('skipUrl'), dropWhenBusy: $('dropWhenBusy'),
    readGift: $('readGift'), readSocial: $('readSocial'), readMember: $('readMember'),
    maxLen: $('maxLen'), maxLenOut: $('maxLenOut'),
    maxQueue: $('maxQueue'), maxQueueOut: $('maxQueueOut'),
    testBtn: $('testBtn'), clearBtn: $('clearBtn'),
    serverUrl: $('serverUrl'), iosNote: $('iosNote'),
  };

  // ---- 状態 ----
  const synth = window.speechSynthesis;
  let voices = [];
  let speakingEnabled = false;   // ユーザーが読み上げ ON にしたか（iOS の音声解放も兼ねる）
  let queue = [];                // {id, name, text} の待機列
  let isSpeaking = false;
  let socket = null;
  let demoTimer = null;
  const recent = [];             // 直近の重複排除用

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // ---- 設定の保存/復元 ----
  function settings() {
    return {
      rate: parseFloat(el.rate.value),
      pitch: parseFloat(el.pitch.value),
      volume: parseFloat(el.volume.value),
      voiceURI: el.voice.value,
      readName: el.readName.checked,
      stripEmoji: el.stripEmoji.checked,
      skipUrl: el.skipUrl.checked,
      dropWhenBusy: el.dropWhenBusy.checked,
      readGift: el.readGift.checked,
      readSocial: el.readSocial.checked,
      readMember: el.readMember.checked,
      maxLen: parseInt(el.maxLen.value, 10),
      maxQueue: parseInt(el.maxQueue.value, 10),
      serverUrl: el.serverUrl.value.trim(),
      username: el.username.value.trim(),
    };
  }

  function saveSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings())); } catch (_) {}
  }

  function loadSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch (_) {}
    if (s.rate != null) el.rate.value = s.rate;
    if (s.pitch != null) el.pitch.value = s.pitch;
    if (s.volume != null) el.volume.value = s.volume;
    if (s.readName != null) el.readName.checked = s.readName;
    if (s.stripEmoji != null) el.stripEmoji.checked = s.stripEmoji;
    if (s.skipUrl != null) el.skipUrl.checked = s.skipUrl;
    if (s.dropWhenBusy != null) el.dropWhenBusy.checked = s.dropWhenBusy;
    if (s.readGift != null) el.readGift.checked = s.readGift;
    if (s.readSocial != null) el.readSocial.checked = s.readSocial;
    if (s.readMember != null) el.readMember.checked = s.readMember;
    if (s.maxLen != null) el.maxLen.value = s.maxLen;
    if (s.maxQueue != null) el.maxQueue.value = s.maxQueue;
    if (s.username) el.username.value = s.username;
    el.serverUrl.value = s.serverUrl || DEFAULT_SERVER;
    el._savedVoiceURI = s.voiceURI || '';
    refreshOutputs();
  }

  function refreshOutputs() {
    el.rateOut.textContent = parseFloat(el.rate.value).toFixed(1);
    el.pitchOut.textContent = parseFloat(el.pitch.value).toFixed(1);
    el.volumeOut.textContent = Math.round(parseFloat(el.volume.value) * 100) + '%';
    el.maxLenOut.textContent = el.maxLen.value;
    el.maxQueueOut.textContent = el.maxQueue.value;
  }

  // ---- 音声一覧 ----
  function loadVoices() {
    voices = synth.getVoices();
    // 日本語を優先的に上へ
    const ja = voices.filter(v => /ja|JP/i.test(v.lang));
    const others = voices.filter(v => !/ja|JP/i.test(v.lang));
    const ordered = [...ja, ...others];

    el.voice.innerHTML = '';
    if (ordered.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = '(利用可能な音声が見つかりません)';
      el.voice.appendChild(opt);
      return;
    }
    for (const v of ordered) {
      const opt = document.createElement('option');
      opt.value = v.voiceURI;
      opt.textContent = `${v.name} (${v.lang})`;
      el.voice.appendChild(opt);
    }
    // 復元: 保存値 → 最初の日本語 → 先頭
    const want = el._savedVoiceURI;
    if (want && ordered.some(v => v.voiceURI === want)) {
      el.voice.value = want;
    } else if (ja.length) {
      el.voice.value = ja[0].voiceURI;
    }
  }

  function selectedVoice() {
    return voices.find(v => v.voiceURI === el.voice.value) || null;
  }

  // ---- テキスト整形 ----
  const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️‍]/gu;
  const URL_RE = /https?:\/\/\S+|www\.\S+/i;

  function sanitize(text) {
    let t = String(text || '');
    if (el.stripEmoji.checked) t = t.replace(EMOJI_RE, '');
    t = t.replace(/\s+/g, ' ').trim();
    const max = parseInt(el.maxLen.value, 10);
    if (t.length > max) t = t.slice(0, max);
    return t;
  }

  function isDuplicate(key) {
    if (recent.includes(key)) return true;
    recent.push(key);
    if (recent.length > 30) recent.shift();
    return false;
  }

  // ---- 効果音（Web Audio。外部ファイル不要で自前生成）----
  let audioCtx = null;
  function unlockAudio() {
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioCtx = new AC();
      }
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    } catch (_) {}
  }
  function playChime(type) {
    if (!audioCtx) return;
    // type ごとに音階を変える（gift=明るい上昇, follow=2音, join=単音）
    const notes = type === 'gift' ? [659, 784, 988, 1175]
      : type === 'follow' ? [587, 880]
      : [523];
    const now = audioCtx.currentTime;
    notes.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.connect(gain); gain.connect(audioCtx.destination);
      const t = now + i * 0.1;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.3, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      osc.start(t); osc.stop(t + 0.3);
    });
  }

  // ---- イベント（ギフト等）のアナウンスをキューに積む ----
  function enqueueAnnouncement(label, text, soundType) {
    if (soundType) playChime(soundType);
    const item = { id: Date.now() + '-' + Math.round(performance.now()), name: label, text };
    queue.push(item);
    const maxQ = parseInt(el.maxQueue.value, 10);
    if (el.dropWhenBusy.checked) { while (queue.length > maxQ) queue.shift(); }
    renderFeed();
    pump();
  }

  // ---- コメント受信 → キュー投入 ----
  function onComment(name, rawText) {
    const text = sanitize(rawText);
    if (!text) return;
    if (el.skipUrl.checked && URL_RE.test(rawText)) return;
    if (isDuplicate(name + '|' + text)) return;

    const item = { id: Date.now() + '-' + Math.round(performance.now()), name, text };
    queue.push(item);

    // 混雑時は古いものを破棄（読み上げ中の1件は別管理なので queue だけ見る）
    const maxQ = parseInt(el.maxQueue.value, 10);
    if (el.dropWhenBusy.checked) {
      while (queue.length > maxQ) queue.shift();
    }

    renderFeed();
    pump();
  }

  // ---- 読み上げポンプ ----
  function pump() {
    if (!speakingEnabled || isSpeaking) return;
    const item = queue.shift();
    if (!item) { renderFeed(); return; }

    isSpeaking = true;
    renderFeed(item.id);

    let phrase = item.text;
    if (el.readName.checked && item.name) phrase = `${item.name}さん。${item.text}`;

    const u = new SpeechSynthesisUtterance(phrase);
    const v = selectedVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'ja-JP'; }
    u.rate = parseFloat(el.rate.value);
    u.pitch = parseFloat(el.pitch.value);
    u.volume = parseFloat(el.volume.value);

    const done = () => {
      isSpeaking = false;
      setTimeout(pump, 60); // 連続発話の安定化
    };
    u.onend = done;
    u.onerror = done;

    try {
      synth.speak(u);
    } catch (_) {
      done();
    }
  }

  // iOS/Chrome の「一定時間で止まる」対策のキープアライブ
  setInterval(() => {
    if (speakingEnabled && isSpeaking && synth.paused) {
      try { synth.resume(); } catch (_) {}
    }
  }, 5000);

  // ---- 表示 ----
  function renderFeed(speakingId) {
    const items = [];
    if (speakingId) {
      // 読み上げ中の見出しは feed の先頭で別途出す
    }
    el.feed.innerHTML = '';
    const list = queue.slice(-12).reverse();
    for (const it of list) {
      const div = document.createElement('div');
      div.className = 'comment';
      const nameHtml = it.name ? `<div class="name">${escapeHtml(it.name)}</div>` : '';
      div.innerHTML = `${nameHtml}<div class="text">${escapeHtml(it.text)}</div>`;
      el.feed.appendChild(div);
    }
    el.queueInfo.textContent = `待機 ${queue.length} 件` + (isSpeaking ? ' ・ 読み上げ中' : '');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // ---- ステータス表示 ----
  function setStatus(state, text) {
    el.status.className = 'status ' + state;
    el.statusText.textContent = text;
  }

  // ---- 読み上げ ON/OFF（iOS 音声解放を兼ねる）----
  function enableSpeaking() {
    speakingEnabled = true;
    el.speakToggle.classList.add('on');
    el.speakIcon.textContent = '⏹';
    el.speakLabel.textContent = '読み上げを停止';
    unlockAudio(); // 効果音用の AudioContext を解放
    // 無音の発話で iOS の音声出力を解放
    try {
      const warm = new SpeechSynthesisUtterance(' ');
      warm.volume = 0;
      synth.speak(warm);
    } catch (_) {}
    pump();
  }

  function disableSpeaking() {
    speakingEnabled = false;
    el.speakToggle.classList.remove('on');
    el.speakIcon.textContent = '🔊';
    el.speakLabel.textContent = '読み上げを開始';
    try { synth.cancel(); } catch (_) {}
    isSpeaking = false;
    renderFeed();
  }

  el.speakToggle.addEventListener('click', () => {
    if (speakingEnabled) disableSpeaking(); else enableSpeaking();
  });

  // ---- 接続 ----
  function normalizeUsername(v) {
    return v.trim().replace(/^@/, '').replace(/\s+/g, '');
  }

  function connect() {
    if (typeof io === 'undefined') {
      setStatus('error', 'Socket.IO 読込失敗');
      alert('通信ライブラリの読み込みに失敗しました。オンラインで開いてください。');
      return;
    }
    const uniqueId = normalizeUsername(el.username.value);
    if (!uniqueId) { alert('配信者のユーザー名を入力してください。'); return; }

    const server = el.serverUrl.value.trim() || DEFAULT_SERVER;
    saveSettings();
    disconnect(true);

    setStatus('connecting', '接続中…');
    el.connectBtn.disabled = true;

    try {
      socket = io(server, { transports: ['websocket', 'polling'] });
    } catch (e) {
      setStatus('error', '接続失敗');
      el.connectBtn.disabled = false;
      return;
    }

    socket.on('connect', () => {
      // TikTok-Chat-Reader サーバーのプロトコル
      socket.emit('setUniqueId', uniqueId, { enableExtendedGiftInfo: false });
      setStatus('connecting', '配信を検索中…');
    });

    socket.on('tiktokConnected', () => {
      setStatus('connected', `接続中: @${uniqueId}`);
      el.connectBtn.disabled = false;
      el.disconnectBtn.disabled = false;
      if (!speakingEnabled) enableSpeaking();
    });

    socket.on('tiktokDisconnected', (reason) => {
      setStatus('error', '配信に接続できません');
      el.connectBtn.disabled = false;
      el.disconnectBtn.disabled = true;
    });

    socket.on('streamEnd', () => {
      setStatus('error', '配信が終了しました');
      el.disconnectBtn.disabled = true;
    });

    socket.on('chat', (data) => {
      const name = data.nickname || data.uniqueId || '';
      onComment(name, data.comment || '');
    });

    // ギフト（連打ギフトは終了時にまとめて読み上げ）
    socket.on('gift', (data) => {
      if (!el.readGift.checked) return;
      // giftType===1 は連打ギフト。repeatEnd=false の途中経過はスキップ
      if (data.giftType === 1 && data.repeatEnd === false) return;
      const name = data.nickname || data.uniqueId || 'どなたか';
      const giftName = data.giftName || data.extendedGiftInfo?.name || 'ギフト';
      const count = data.repeatCount || 1;
      const countText = count > 1 ? `${count}個` : '';
      enqueueAnnouncement('🎁 ギフト', `${name}さんが${giftName}${countText}をくれました！ありがとう！`, 'gift');
    });

    // フォロー / シェア（social イベント）
    socket.on('social', (data) => {
      if (!el.readSocial.checked) return;
      const name = data.nickname || data.uniqueId || 'どなたか';
      const kind = (data.displayType || '') + ' ' + (data.label || '');
      if (/follow/i.test(kind)) {
        enqueueAnnouncement('💗 フォロー', `${name}さんがフォローしました！ありがとう！`, 'follow');
      } else if (/share/i.test(kind)) {
        enqueueAnnouncement('🔁 シェア', `${name}さんがシェアしてくれました！`, 'follow');
      }
    });

    // 入室（既定オフ。多いと賑やかなので）
    socket.on('member', (data) => {
      if (!el.readMember.checked) return;
      const name = data.nickname || data.uniqueId || 'どなたか';
      enqueueAnnouncement('🚪 入室', `${name}さんが入室しました`, 'join');
    });

    socket.on('disconnect', () => {
      if (socket) setStatus('error', '切断されました');
      el.disconnectBtn.disabled = true;
    });

    socket.on('connect_error', () => {
      setStatus('error', 'サーバーに接続できません');
      el.connectBtn.disabled = false;
    });
  }

  function disconnect(silent) {
    if (socket) {
      try { socket.disconnect(); } catch (_) {}
      socket = null;
    }
    el.disconnectBtn.disabled = true;
    el.connectBtn.disabled = false;
    if (!silent) setStatus('', '未接続');
  }

  el.connectBtn.addEventListener('click', connect);
  el.disconnectBtn.addEventListener('click', () => disconnect());

  // ---- デモモード ----
  const DEMO = [
    ['さくら', 'こんばんは！はじめて見ました〜'],
    ['ゆうた', '配信ありがとう！応援してます'],
    ['Mike', 'Hello from Tokyo!'],
    ['のんちゃん', '今日のメイクかわいい😍'],
    ['けんと', '次の曲リクエストいいですか？'],
    ['あおい', 'フォローしました！これからもがんばってください'],
    ['Rin', '画質きれいですね'],
    ['たろう', 'おつかれさまです、毎日見てます'],
  ];

  function toggleDemo() {
    if (demoTimer) {
      clearInterval(demoTimer);
      demoTimer = null;
      el.demoBtn.textContent = '🧪 デモ（接続なしで試す）';
      setStatus('', '未接続');
      return;
    }
    if (!speakingEnabled) enableSpeaking();
    setStatus('connected', 'デモ再生中');
    el.demoBtn.textContent = '⏹ デモを停止';
    let i = 0;
    const tick = () => {
      // 3回に1回はギフト/フォローのデモ（効果音の確認用）
      if (i > 0 && i % 3 === 0 && el.readGift.checked) {
        const [n] = DEMO[i % DEMO.length];
        enqueueAnnouncement('🎁 ギフト', `${n}さんがバラ3個をくれました！ありがとう！`, 'gift');
      } else if (i > 0 && i % 4 === 0 && el.readSocial.checked) {
        const [n] = DEMO[i % DEMO.length];
        enqueueAnnouncement('💗 フォロー', `${n}さんがフォローしました！ありがとう！`, 'follow');
      } else {
        const [n, t] = DEMO[i % DEMO.length];
        onComment(n, t);
      }
      i++;
    };
    tick();
    demoTimer = setInterval(tick, 3500);
  }
  el.demoBtn.addEventListener('click', toggleDemo);

  // ---- 設定 UI ----
  el.testBtn.addEventListener('click', () => {
    if (!speakingEnabled) enableSpeaking();
    onComment('テスト', 'これはテストの読み上げです。聞こえますか？');
  });
  el.clearBtn.addEventListener('click', () => {
    queue = [];
    try { synth.cancel(); } catch (_) {}
    isSpeaking = false;
    renderFeed();
  });

  for (const ctrl of [el.rate, el.pitch, el.volume, el.maxLen, el.maxQueue]) {
    ctrl.addEventListener('input', () => { refreshOutputs(); saveSettings(); });
  }
  for (const ctrl of [el.voice, el.readName, el.stripEmoji, el.skipUrl, el.dropWhenBusy,
    el.readGift, el.readSocial, el.readMember, el.username, el.serverUrl]) {
    ctrl.addEventListener('change', saveSettings);
  }

  // ---- 初期化 ----
  loadSettings();
  loadVoices();
  if (synth.onvoiceschanged !== undefined) {
    synth.onvoiceschanged = loadVoices;
  }
  if (isIOS) el.iosNote.hidden = false;

  // Service Worker（ホーム画面追加・オフラインシェル用）
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
