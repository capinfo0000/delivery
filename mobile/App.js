import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  SafeAreaView, View, Text, TextInput, TouchableOpacity, ScrollView,
  Switch, StyleSheet, Platform, StatusBar,
} from 'react-native';
import Slider from '@react-native-community/slider';
import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io } from 'socket.io-client';

const DEFAULT_SERVER = 'https://tiktok-chat-reader.zerody.one/';
const STORE_KEY = 'ttcomment.settings.v1';

const C = {
  bg: '#0b0b12', panel: '#15151f', panel2: '#1d1d2a', line: '#2a2a3a',
  text: '#f2f2f7', muted: '#9a9ab0', accent: '#fe2c55', cyan: '#25f4ee',
  ok: '#3ddc97', warn: '#ffb020',
};

const DEMO = [
  ['さくら', 'こんばんは！はじめて見ました〜'],
  ['ゆうた', '配信ありがとう！応援してます'],
  ['Mike', 'Hello from Tokyo!'],
  ['のんちゃん', '今日のメイクかわいい'],
  ['けんと', '次の曲リクエストいいですか？'],
  ['あおい', 'フォローしました！これからも頑張ってください'],
];

const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️‍]/gu;
const URL_RE = /https?:\/\/\S+|www\.\S+/i;

export default function App() {
  // 設定
  const [rate, setRate] = useState(1.0);
  const [pitch, setPitch] = useState(1.0);
  const [readName, setReadName] = useState(false);
  const [stripEmoji, setStripEmoji] = useState(true);
  const [skipUrl, setSkipUrl] = useState(true);
  const [dropWhenBusy, setDropWhenBusy] = useState(true);
  const [readGift, setReadGift] = useState(true);
  const [readSocial, setReadSocial] = useState(true);
  const [readMember, setReadMember] = useState(false);
  const [maxLen, setMaxLen] = useState(80);
  const [maxQueue, setMaxQueue] = useState(6);
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER);
  const [username, setUsername] = useState('');

  // 実行状態
  const [speaking, setSpeaking] = useState(false);
  const [status, setStatus] = useState({ state: '', text: '未接続' });
  const [feed, setFeed] = useState([]);
  const [demoOn, setDemoOn] = useState(false);

  // 参照（コールバック内で最新値を使う）
  const queueRef = useRef([]);
  const isSpeakingRef = useRef(false);
  const speakingRef = useRef(false);
  const socketRef = useRef(null);
  const demoTimerRef = useRef(null);
  const recentRef = useRef([]);
  const keepAliveRef = useRef(null);
  const giftSndRef = useRef(null);
  const followSndRef = useRef(null);
  const settingsRef = useRef({});

  // 最新設定を ref に同期（socketハンドラから参照するため）
  useEffect(() => {
    settingsRef.current = {
      rate, pitch, readName, stripEmoji, skipUrl, dropWhenBusy,
      readGift, readSocial, readMember, maxLen, maxQueue,
    };
  }, [rate, pitch, readName, stripEmoji, skipUrl, dropWhenBusy,
    readGift, readSocial, readMember, maxLen, maxQueue]);

  // 設定の復元
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORE_KEY);
        if (raw) {
          const s = JSON.parse(raw);
          if (s.rate != null) setRate(s.rate);
          if (s.pitch != null) setPitch(s.pitch);
          if (s.readName != null) setReadName(s.readName);
          if (s.stripEmoji != null) setStripEmoji(s.stripEmoji);
          if (s.skipUrl != null) setSkipUrl(s.skipUrl);
          if (s.dropWhenBusy != null) setDropWhenBusy(s.dropWhenBusy);
          if (s.readGift != null) setReadGift(s.readGift);
          if (s.readSocial != null) setReadSocial(s.readSocial);
          if (s.readMember != null) setReadMember(s.readMember);
          if (s.maxLen != null) setMaxLen(s.maxLen);
          if (s.maxQueue != null) setMaxQueue(s.maxQueue);
          if (s.serverUrl) setServerUrl(s.serverUrl);
          if (s.username) setUsername(s.username);
        }
      } catch (_) {}
    })();
    // チャイム音を事前ロード
    (async () => {
      try {
        const g = await Audio.Sound.createAsync(require('./assets/gift.wav'));
        giftSndRef.current = g.sound;
        const f = await Audio.Sound.createAsync(require('./assets/follow.wav'));
        followSndRef.current = f.sound;
      } catch (_) {}
    })();
    return () => {
      try { giftSndRef.current && giftSndRef.current.unloadAsync(); } catch (_) {}
      try { followSndRef.current && followSndRef.current.unloadAsync(); } catch (_) {}
      try { keepAliveRef.current && keepAliveRef.current.unloadAsync(); } catch (_) {}
      if (socketRef.current) socketRef.current.disconnect();
      if (demoTimerRef.current) clearInterval(demoTimerRef.current);
    };
  }, []);

  // 設定の保存
  useEffect(() => {
    const s = {
      rate, pitch, readName, stripEmoji, skipUrl, dropWhenBusy,
      readGift, readSocial, readMember, maxLen, maxQueue, serverUrl, username,
    };
    AsyncStorage.setItem(STORE_KEY, JSON.stringify(s)).catch(() => {});
  }, [rate, pitch, readName, stripEmoji, skipUrl, dropWhenBusy, readGift,
    readSocial, readMember, maxLen, maxQueue, serverUrl, username]);

  // ---- テキスト整形 ----
  const sanitize = useCallback((text) => {
    const s = settingsRef.current;
    let t = String(text || '');
    if (s.stripEmoji) t = t.replace(EMOJI_RE, '');
    t = t.replace(/\s+/g, ' ').trim();
    if (t.length > s.maxLen) t = t.slice(0, s.maxLen);
    return t;
  }, []);

  const isDuplicate = useCallback((key) => {
    const r = recentRef.current;
    if (r.includes(key)) return true;
    r.push(key);
    if (r.length > 30) r.shift();
    return false;
  }, []);

  const renderFeed = useCallback(() => {
    setFeed(queueRef.current.slice(-12).reverse().map((it) => ({ ...it })));
  }, []);

  // ---- キュー投入 ----
  const pushItem = useCallback((name, text) => {
    const s = settingsRef.current;
    queueRef.current.push({ id: String(Date.now()) + Math.random(), name, text });
    if (s.dropWhenBusy) {
      while (queueRef.current.length > s.maxQueue) queueRef.current.shift();
    }
    renderFeed();
    pump();
  }, []);

  const onComment = useCallback((name, rawText) => {
    const s = settingsRef.current;
    const text = sanitize(rawText);
    if (!text) return;
    if (s.skipUrl && URL_RE.test(rawText)) return;
    if (isDuplicate(name + '|' + text)) return;
    pushItem(name, text);
  }, [sanitize, isDuplicate, pushItem]);

  const enqueueAnnouncement = useCallback((label, text, sound) => {
    if (sound === 'gift' && giftSndRef.current) {
      giftSndRef.current.replayAsync().catch(() => {});
    } else if (sound === 'follow' && followSndRef.current) {
      followSndRef.current.replayAsync().catch(() => {});
    }
    pushItem(label, text);
  }, [pushItem]);

  // ---- 読み上げポンプ ----
  const pump = useCallback(() => {
    if (!speakingRef.current || isSpeakingRef.current) return;
    const item = queueRef.current.shift();
    if (!item) { renderFeed(); return; }
    isSpeakingRef.current = true;
    renderFeed();

    const s = settingsRef.current;
    const isAnnouncement = /^[🎁💗🔁🚪]/.test(item.name || '');
    let phrase = item.text;
    if (s.readName && item.name && !isAnnouncement) phrase = `${item.name}さん。${item.text}`;

    const done = () => {
      isSpeakingRef.current = false;
      setTimeout(pump, 60);
    };
    try {
      Speech.speak(phrase, {
        language: 'ja-JP',
        rate: s.rate,
        pitch: s.pitch,
        onDone: done,
        onStopped: done,
        onError: done,
      });
    } catch (_) {
      done();
    }
  }, [renderFeed]);

  // ---- 背面維持（無音ループ）＋音声セッション ----
  const startKeepAlive = useCallback(async () => {
    try {
      await Audio.setAudioModeAsync({
        staysActiveInBackground: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });
      if (!keepAliveRef.current) {
        const { sound } = await Audio.Sound.createAsync(
          require('./assets/silence.wav'),
          { isLooping: true, volume: 0.02 }
        );
        keepAliveRef.current = sound;
      }
      await keepAliveRef.current.playAsync();
    } catch (_) {}
  }, []);

  const stopKeepAlive = useCallback(async () => {
    try { keepAliveRef.current && (await keepAliveRef.current.pauseAsync()); } catch (_) {}
  }, []);

  // ---- 読み上げ ON/OFF ----
  const enableSpeaking = useCallback(async () => {
    speakingRef.current = true;
    setSpeaking(true);
    await startKeepAlive();
    pump();
  }, [pump, startKeepAlive]);

  const disableSpeaking = useCallback(async () => {
    speakingRef.current = false;
    setSpeaking(false);
    try { Speech.stop(); } catch (_) {}
    await stopKeepAlive();
    isSpeakingRef.current = false;
    renderFeed();
  }, [renderFeed, stopKeepAlive]);

  const toggleSpeak = useCallback(() => {
    if (speakingRef.current) disableSpeaking(); else enableSpeaking();
  }, [enableSpeaking, disableSpeaking]);

  // ---- 接続 ----
  const connect = useCallback(() => {
    const uniqueId = username.trim().replace(/^@/, '').replace(/\s+/g, '');
    if (!uniqueId) { setStatus({ state: 'error', text: 'ユーザー名を入力' }); return; }
    const server = serverUrl.trim() || DEFAULT_SERVER;
    disconnect(true);
    setStatus({ state: 'connecting', text: '接続中…' });

    const socket = io(server, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('setUniqueId', uniqueId, { enableExtendedGiftInfo: false });
      setStatus({ state: 'connecting', text: '配信を検索中…' });
    });
    socket.on('tiktokConnected', () => {
      setStatus({ state: 'connected', text: `接続中: @${uniqueId}` });
      if (!speakingRef.current) enableSpeaking();
    });
    socket.on('tiktokDisconnected', () => setStatus({ state: 'error', text: '配信に接続できません' }));
    socket.on('streamEnd', () => setStatus({ state: 'error', text: '配信が終了しました' }));
    socket.on('chat', (d) => onComment(d.nickname || d.uniqueId || '', d.comment || ''));
    socket.on('gift', (d) => {
      const s = settingsRef.current;
      if (!s.readGift) return;
      if (d.giftType === 1 && d.repeatEnd === false) return;
      const name = d.nickname || d.uniqueId || 'どなたか';
      const giftName = d.giftName || 'ギフト';
      const count = d.repeatCount || 1;
      enqueueAnnouncement('🎁 ギフト', `${name}さんが${giftName}${count > 1 ? count + '個' : ''}をくれました！ありがとう！`, 'gift');
    });
    socket.on('social', (d) => {
      const s = settingsRef.current;
      if (!s.readSocial) return;
      const name = d.nickname || d.uniqueId || 'どなたか';
      const kind = (d.displayType || '') + ' ' + (d.label || '');
      if (/follow/i.test(kind)) enqueueAnnouncement('💗 フォロー', `${name}さんがフォローしました！ありがとう！`, 'follow');
      else if (/share/i.test(kind)) enqueueAnnouncement('🔁 シェア', `${name}さんがシェアしてくれました！`, 'follow');
    });
    socket.on('member', (d) => {
      const s = settingsRef.current;
      if (!s.readMember) return;
      const name = d.nickname || d.uniqueId || 'どなたか';
      enqueueAnnouncement('🚪 入室', `${name}さんが入室しました`, null);
    });
    socket.on('disconnect', () => setStatus({ state: 'error', text: '切断されました' }));
    socket.on('connect_error', () => setStatus({ state: 'error', text: 'サーバーに接続できません' }));
  }, [username, serverUrl, onComment, enqueueAnnouncement, enableSpeaking]);

  const disconnect = useCallback((silent) => {
    if (socketRef.current) { try { socketRef.current.disconnect(); } catch (_) {} socketRef.current = null; }
    if (!silent) setStatus({ state: '', text: '未接続' });
  }, []);

  // ---- デモ ----
  const toggleDemo = useCallback(() => {
    if (demoTimerRef.current) {
      clearInterval(demoTimerRef.current);
      demoTimerRef.current = null;
      setDemoOn(false);
      setStatus({ state: '', text: '未接続' });
      return;
    }
    if (!speakingRef.current) enableSpeaking();
    setDemoOn(true);
    setStatus({ state: 'connected', text: 'デモ再生中' });
    let i = 0;
    const tick = () => {
      const s = settingsRef.current;
      if (i > 0 && i % 3 === 0 && s.readGift) {
        enqueueAnnouncement('🎁 ギフト', `${DEMO[i % DEMO.length][0]}さんがバラ3個をくれました！ありがとう！`, 'gift');
      } else if (i > 0 && i % 4 === 0 && s.readSocial) {
        enqueueAnnouncement('💗 フォロー', `${DEMO[i % DEMO.length][0]}さんがフォローしました！ありがとう！`, 'follow');
      } else {
        const [n, t] = DEMO[i % DEMO.length];
        onComment(n, t);
      }
      i++;
    };
    tick();
    demoTimerRef.current = setInterval(tick, 3500);
  }, [enableSpeaking, enqueueAnnouncement, onComment]);

  const testSpeak = useCallback(() => {
    if (!speakingRef.current) enableSpeaking();
    onComment('テスト', 'これはテストの読み上げです。聞こえますか？');
  }, [enableSpeaking, onComment]);

  const clearQueue = useCallback(() => {
    queueRef.current = [];
    try { Speech.stop(); } catch (_) {}
    isSpeakingRef.current = false;
    renderFeed();
  }, [renderFeed]);

  const dotColor = status.state === 'connected' ? C.ok
    : status.state === 'connecting' ? C.warn
    : status.state === 'error' ? C.accent : C.muted;

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" />
      <View style={s.header}>
        <View style={s.logo} />
        <Text style={s.h1}>コメント読み上げ</Text>
        <View style={s.statusPill}>
          <View style={[s.dot, { backgroundColor: dotColor }]} />
          <Text style={s.statusText}>{status.text}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.main} keyboardShouldPersistTaps="handled">
        {/* Speak toggle */}
        <TouchableOpacity
          style={[s.speakToggle, speaking && s.speakToggleOn]}
          onPress={toggleSpeak}
          activeOpacity={0.85}
        >
          <Text style={s.speakLabel}>{speaking ? '⏹  読み上げを停止' : '🔊  読み上げを開始'}</Text>
        </TouchableOpacity>

        {/* Connect */}
        <View style={s.card}>
          <Text style={s.cardTitle}>① 配信に接続</Text>
          <TextInput
            style={s.input}
            value={username}
            onChangeText={setUsername}
            placeholder="配信者のユーザー名（例: @tiktok）"
            placeholderTextColor={C.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={s.row}>
            <TouchableOpacity style={[s.btn, s.btnPrimary, s.grow]} onPress={connect}>
              <Text style={s.btnText}>接続</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, s.btnGhost]} onPress={() => disconnect()}>
              <Text style={s.btnText}>切断</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={[s.btn, s.btnCyan, { marginTop: 10 }]} onPress={toggleDemo}>
            <Text style={s.btnText}>{demoOn ? '⏹ デモを停止' : '🧪 デモ（接続なしで試す）'}</Text>
          </TouchableOpacity>
        </View>

        {/* Feed */}
        <View style={s.card}>
          <Text style={s.cardTitle}>コメント（待機 {feed.length} 件）</Text>
          {feed.length === 0 && <Text style={s.muted}>コメントはここに表示されます</Text>}
          {feed.map((it) => (
            <View key={it.id} style={s.comment}>
              {!!it.name && <Text style={s.commentName}>{it.name}</Text>}
              <Text style={s.commentText}>{it.text}</Text>
            </View>
          ))}
        </View>

        {/* Settings */}
        <View style={s.card}>
          <Text style={s.cardTitle}>読み上げ設定</Text>

          <Text style={s.label}>速さ  {rate.toFixed(1)}</Text>
          <Slider minimumValue={0.5} maximumValue={2} step={0.1} value={rate}
            onValueChange={setRate} minimumTrackTintColor={C.accent} thumbTintColor={C.accent} />

          <Text style={s.label}>高さ  {pitch.toFixed(1)}</Text>
          <Slider minimumValue={0.5} maximumValue={2} step={0.1} value={pitch}
            onValueChange={setPitch} minimumTrackTintColor={C.accent} thumbTintColor={C.accent} />

          <Row label="投稿者名を読む" value={readName} onChange={setReadName} />
          <Row label="絵文字を読まない" value={stripEmoji} onChange={setStripEmoji} />
          <Row label="URLを含むコメントを飛ばす" value={skipUrl} onChange={setSkipUrl} />
          <Row label="混雑時は古いコメントを飛ばす" value={dropWhenBusy} onChange={setDropWhenBusy} />

          <View style={s.hr} />
          <Row label="🎁 ギフトを読み上げ＋効果音" value={readGift} onChange={setReadGift} />
          <Row label="💗 フォロー/シェアを読み上げ＋効果音" value={readSocial} onChange={setReadSocial} />
          <Row label="🚪 入室を読み上げ" value={readMember} onChange={setReadMember} />

          <View style={s.hr} />
          <Text style={s.label}>1コメントの最大文字数  {maxLen}</Text>
          <Slider minimumValue={20} maximumValue={200} step={10} value={maxLen}
            onValueChange={setMaxLen} minimumTrackTintColor={C.accent} thumbTintColor={C.accent} />
          <Text style={s.label}>待機キュー上限  {maxQueue}</Text>
          <Slider minimumValue={1} maximumValue={20} step={1} value={maxQueue}
            onValueChange={setMaxQueue} minimumTrackTintColor={C.accent} thumbTintColor={C.accent} />

          <View style={s.row}>
            <TouchableOpacity style={[s.btn, s.btnGhost, s.grow]} onPress={testSpeak}>
              <Text style={s.btnText}>🔈 テスト</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, s.btnGhost, s.grow]} onPress={clearQueue}>
              <Text style={s.btnText}>🗑 キュー消去</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Server */}
        <View style={s.card}>
          <Text style={s.cardTitle}>サーバー設定（上級者向け）</Text>
          <TextInput
            style={s.input}
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder={DEFAULT_SERVER}
            placeholderTextColor={C.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={s.muted}>
            コメント取得には TikTok チャット中継サーバーが必要です。安定させたい場合は
            TikTok-Chat-Reader を自前で立て、その URL を指定してください。
          </Text>
        </View>

        <Text style={[s.muted, { textAlign: 'center', marginTop: 8 }]}>
          配信中は読み上げ音がマイクに入らないようイヤホン推奨
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, onChange }) {
  return (
    <View style={s.switchRow}>
      <Text style={s.switchLabel}>{label}</Text>
      <Switch value={value} onValueChange={onChange}
        trackColor={{ false: '#333', true: C.accent }} thumbColor="#fff" />
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg, paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line,
  },
  logo: { width: 26, height: 26, borderRadius: 8, backgroundColor: C.accent },
  h1: { flex: 1, color: C.text, fontSize: 16, fontWeight: '700' },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1,
    borderColor: C.line, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.muted },
  statusText: { color: C.muted, fontSize: 12 },
  main: { padding: 14, gap: 14 },
  speakToggle: {
    borderRadius: 12, paddingVertical: 18, alignItems: 'center', backgroundColor: C.accent,
  },
  speakToggleOn: { backgroundColor: '#0e6e6a' },
  speakLabel: { color: '#fff', fontSize: 18, fontWeight: '700' },
  card: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 14, gap: 10 },
  cardTitle: { color: C.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  input: {
    backgroundColor: C.panel2, borderWidth: 1, borderColor: C.line, color: C.text,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16,
  },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  grow: { flex: 1 },
  btn: { borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', backgroundColor: C.panel2 },
  btnPrimary: { backgroundColor: C.accent },
  btnCyan: { backgroundColor: '#0e6e6a' },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.line },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  muted: { color: C.muted, fontSize: 12, lineHeight: 18 },
  comment: { backgroundColor: C.panel2, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 10 },
  commentName: { color: C.cyan, fontSize: 12, fontWeight: '700', marginBottom: 2 },
  commentText: { color: C.text, fontSize: 15 },
  label: { color: C.muted, fontSize: 13, marginTop: 4 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  switchLabel: { color: C.text, fontSize: 15, flex: 1, paddingRight: 10 },
  hr: { height: 1, backgroundColor: C.line, marginVertical: 4 },
});
