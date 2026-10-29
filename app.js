'use strict';

const $ = (selector) => document.querySelector(selector);
const main = $('#main');
const messages = $('#messages');
const input = $('#input');
const status = $('#status');
const drawer = $('#drawer');
const HISTORY_KEY = 'exion_history';
const MODE_KEY = 'exion_mode';
const ACCESS_KEY = 'exion_access_password';
const CLIENT_ID_KEY = 'exion_client_id';

function getClientId() {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : `exion-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}
const CLIENT_ID = getClientId();

function readHistory() {
  try {
    const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    if (!Array.isArray(stored)) return [];
    return stored.filter((item) =>
      item && ['user', 'assistant'].includes(item.role) && typeof item.text === 'string'
    ).slice(-500);
  } catch {
    return [];
  }
}

let history = readHistory();
let backend = { available: false, configured: false, passwordRequired: false, accessConfigured: false, model: '', imageVision: false, imageGenerate: false, imageEdit: false };
let isSending = false;
let recognition = null;
let listening = false;
let selectedImage = null;
$('#mode').value = localStorage.getItem(MODE_KEY) || 'Inteligente';

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-500)));
  } catch {
    toast('Não foi possível salvar a conversa neste navegador.');
  }
}

function addBubble(role, text, save = true) {
  const row = document.createElement('div');
  row.className = `message ${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  row.appendChild(bubble);
  messages.appendChild(row);
  if (save) {
    history.push({ role, text });
    history = history.slice(-500);
    saveHistory();
    main.scrollTop = main.scrollHeight;
  }
  return { row, bubble };
}

function render() {
  messages.replaceChildren();
  $('#welcome').hidden = history.length > 0;
  history.forEach(({ role, text }) => addBubble(role, text, false));
  main.scrollTop = main.scrollHeight;
}

function toast(text) {
  const message = document.createElement('div');
  message.className = 'toast';
  message.textContent = text;
  document.body.appendChild(message);
  window.setTimeout(() => message.remove(), 2500);
}

function setStatus() {
  if (!backend.available) {
    status.textContent = 'Backend indisponível • modo demonstração local';
    $('#backendInfo').textContent = 'Inicie o servidor e configure OPENROUTER_API_KEY no arquivo .env.';
    $('#accessSetting').hidden = false;
    return;
  }
  if (!backend.configured) {
    status.textContent = 'Modo demonstração • configure uma chave OpenRouter no servidor';
    $('#backendInfo').textContent = 'Servidor online, mas OPENROUTER_API_KEY ainda não foi configurada.';
    $('#accessSetting').hidden = backend.passwordRequired;
    return;
  }
  $('#accessSetting').hidden = !backend.passwordRequired;
  if (backend.passwordRequired && !sessionStorage.getItem(ACCESS_KEY)) {
    status.textContent = 'Backend online • informe a senha de acesso em ☰';
    $('#backendInfo').textContent = `Servidor conectado ao modelo ${backend.model}. Insira a senha de acesso do app abaixo; internet, GitHub e terminal seguro estão disponíveis no backend.`;
    return;
  }
  status.textContent = `OpenRouter conectado • ${backend.model}`;
  $('#backendInfo').textContent = `Servidor conectado ao modelo ${backend.model}. Internet, GitHub, terminal seguro e edição de imagens podem estar disponíveis no backend.`;
}

async function checkBackend(showToast = false) {
  try {
    const response = await fetch('./api/health', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`O servidor respondeu com HTTP ${response.status}.`);
    const data = await response.json();
    backend = {
      available: true,
      configured: data.configured === true,
      passwordRequired: data.passwordRequired === true,
      accessConfigured: data.accessConfigured === true,
      model: typeof data.model === 'string' ? data.model : '',
      imageVision: data.tools?.imageVision === true,
      imageGenerate: data.tools?.imageGenerate === true,
      imageEdit: data.tools?.imageEdit === true
    };
    if (showToast) toast(backend.configured ? 'Backend OpenRouter conectado.' : 'Servidor online; falta configurar a chave.');
  } catch (error) {
    backend = { available: false, configured: false, passwordRequired: false, accessConfigured: false, model: '' };
    if (showToast) toast(`Não foi possível verificar o backend: ${error.message}`);
  }
  setStatus();
}

function localAI(question) {
  const text = question.toLowerCase();
  if (text.includes('olá') || text.includes('oi') || text.includes('hello')) {
    return 'Oi! Eu sou a EXION. Esta resposta está sendo gerada pelo modo de demonstração local. Configure o backend OpenRouter para conversar com um modelo de IA.';
  }
  return 'Esta é uma resposta de demonstração: ainda não há uma IA conectada. Inicie o backend e configure OPENROUTER_API_KEY no arquivo .env para usar o OpenRouter.';
}

function showTyping() {
  const { row, bubble } = addBubble('assistant', '', false);
  bubble.innerHTML = '<span class="typing" aria-label="A EXION está pensando"><i class="dot"></i><i class="dot"></i><i class="dot"></i></span>';
  main.scrollTop = main.scrollHeight;
  return row;
}

async function sendToBackend() {
  const response = await fetch('./api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(sessionStorage.getItem(ACCESS_KEY) ? { 'X-Exion-Password': sessionStorage.getItem(ACCESS_KEY) } : {})
    },
    body: JSON.stringify({
      messages: history.slice(-12).map(({ role, text }) => ({ role, content: text })),
      clientId: CLIENT_ID,
      mode: $('#mode').value
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `O backend respondeu com HTTP ${response.status}.`);
  if (typeof data.reply !== 'string' || !data.reply.trim()) {
    throw new Error('O backend retornou uma resposta vazia ou inválida.');
  }
  return data.reply;
}


function looksLikeImageGeneration(text) {
  return /(^|\b)(crie|criar|gere|gerar|faça|faca|fazer|desenhe|desenhar|produza|produzir|gere uma imagem|crie uma foto)(\b|$)/i.test(text);
}

function looksLikeImageEdit(text) {
  return /\b(edite|editar|mude|mudar|remova|remover|adicione|adicionar|troque|trocar|melhore|melhorar|apague|apagar|coloque|deixe|transforme|transformar|recorte|recortar|fundo|cor|parede|porta)\b/i.test(text);
}

function addImageBubble(role, imageUrl, caption = '') {
  const row = document.createElement('div');
  row.className = `message ${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  const img = document.createElement('img');
  img.src = imageUrl;
  img.alt = caption || 'Imagem da EXION';
  img.style.maxWidth = '100%';
  img.style.borderRadius = '14px';
  img.style.display = 'block';
  bubble.appendChild(img);
  if (caption) {
    const p = document.createElement('div');
    p.textContent = caption;
    p.style.marginTop = '8px';
    bubble.appendChild(p);
  }
  row.appendChild(bubble);
  messages.appendChild(row);
  main.scrollTop = main.scrollHeight;
  return row;
}

async function imageRequest(endpoint, body) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(sessionStorage.getItem(ACCESS_KEY) ? { 'X-Exion-Password': sessionStorage.getItem(ACCESS_KEY) } : {}) },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `O backend respondeu com HTTP ${response.status}.`);
  return data;
}

async function analyzeSelectedImage(prompt) {
  const data = await imageRequest('./api/image-vision', { image: selectedImage.dataUrl, prompt });
  return data.reply;
}

async function generateImage(prompt) {
  const data = await imageRequest('./api/image-generate', { prompt });
  const imageUrl = data.image || data.imageUrl;
  if (!imageUrl) throw new Error('A EXION não recebeu a imagem criada.');
  return imageUrl;
}

async function handleImageAction(prompt) {
  if (selectedImage) {
    if (looksLikeImageEdit(prompt)) return { type: 'edit', data: await imageRequest('./api/image-edit', { image: selectedImage.dataUrl, prompt }) };
    return { type: 'vision', data: await imageRequest('./api/image-vision', { image: selectedImage.dataUrl, prompt }) };
  }
  if (looksLikeImageGeneration(prompt)) return { type: 'generate', data: await imageRequest('./api/image-generate', { prompt }) };
  return null;
}

async function ask() {
  const question = input.value.trim();
  if (!question || isSending) return;
  input.value = '';
  input.style.height = 'auto';
  $('#welcome').hidden = true;
  addBubble('user', question);
  const typing = showTyping();
  isSending = true;
  $('#sendBtn').disabled = true;
  status.textContent = 'EXION está analisando…';

  try {
    const imageAction = backend.available ? await handleImageAction(question) : null;
    typing.remove();
    if (imageAction?.type === 'vision') {
      addBubble('assistant', imageAction.data.reply);
      selectedImage = null;
      $('#fileInput').value = '';
    } else if (imageAction?.type === 'edit') {
      const url = imageAction.data.image || imageAction.data.imageUrl;
      if (!url) throw new Error('A edição não retornou uma imagem.');
      addImageBubble('assistant', url, 'Imagem editada pela EXION.');
      selectedImage = null;
      $('#fileInput').value = '';
    } else if (imageAction?.type === 'generate') {
      const url = imageAction.data.image || imageAction.data.imageUrl;
      if (!url) throw new Error('A geração não retornou uma imagem.');
      addImageBubble('assistant', url, 'Imagem criada pela EXION.');
    } else {
      const answer = backend.configured ? await sendToBackend() : localAI(question);
      addBubble('assistant', answer);
    }
  } catch (error) {
    typing.remove();
    const message = `Não consegui concluir a tarefa. ${error.message}`;
    const { row } = addBubble('assistant', message);
    row.classList.add('error');
  } finally {
    isSending = false;
    $('#sendBtn').disabled = false;
    setStatus();
  }
}

function speak(text) {
  if (!('speechSynthesis' in window)) {
    toast('Este navegador não oferece leitura de voz.');
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'pt-BR';
  utterance.rate = 0.98;
  window.speechSynthesis.speak(utterance);
}

// ==================== EXION VOZ REAL-TIME ====================
// Conversa de áudio bidirecional: microfone -> Gemini Live -> áudio PCM no alto-falante.
let voiceMode = false;
let liveSocket = null;
let liveAudioContext = null;
let livePlaybackContext = null;
let liveMicStream = null;
let liveMicSource = null;
let liveProcessor = null;
let liveNextPlaybackTime = 0;
let liveSpeaking = false;
let liveUserTranscript = '';
let liveAssistantTranscript = '';
let liveReady = false;

function createVoiceUI() {
  if ($('#exionVoiceOverlay')) return;
  const style = document.createElement('style');
  style.id = 'exionVoiceStyles';
  style.textContent = `
    #exionVoiceOverlay{position:fixed;inset:0;z-index:100;background:rgba(3,10,24,.9);backdrop-filter:blur(14px);display:none;align-items:center;justify-content:center;padding:20px}
    #exionVoiceOverlay.open{display:flex}
    .exionVoiceCard{width:min(470px,100%);border-radius:30px;padding:30px 24px;text-align:center;background:linear-gradient(160deg,#07152d,#0b2342);border:1px solid rgba(61,191,255,.3);color:#fff;box-shadow:0 24px 80px rgba(0,0,0,.5)}
    .exionVoiceOrb{width:174px;height:174px;margin:8px auto 22px;border-radius:50%;display:grid;place-items:center;background:radial-gradient(circle,#e6fcff 0 3%,#57e4ff 12%,#168cff 38%,#07152d 70%);box-shadow:0 0 28px rgba(32,200,255,.6),0 0 85px rgba(20,130,255,.28),inset 0 0 34px #fff5;font-size:54px;font-weight:900;position:relative;transition:.25s}
    .exionVoiceOrb:before,.exionVoiceOrb:after{content:'';position:absolute;inset:-13px;border:1px solid rgba(65,215,255,.28);border-radius:50%}
    .exionVoiceOrb:after{inset:-28px;border-color:rgba(65,215,255,.12)}
    .exionVoiceOrb.listening{animation:exionPulse .95s infinite}
    .exionVoiceOrb.speaking{animation:exionSpeak 1.15s infinite}
    @keyframes exionPulse{50%{transform:scale(1.07);box-shadow:0 0 75px rgba(32,200,255,.9),0 0 135px rgba(20,130,255,.34)}}
    @keyframes exionSpeak{50%{transform:scale(1.055);box-shadow:0 0 68px rgba(32,200,255,.8),0 0 120px rgba(20,130,255,.3)}}
    #exionVoiceState{font-size:15px;opacity:.84;min-height:22px;margin-bottom:15px}
    #exionVoiceText{min-height:66px;max-height:170px;overflow:auto;margin:8px 0 20px;font-size:17px;line-height:1.45;color:#dcefff}
    .exionVoiceActions{display:flex;gap:10px;justify-content:center}
    .exionVoiceActions button{border:0;border-radius:14px;padding:12px 18px;font-weight:800;cursor:pointer}
    #exionVoiceListen{background:#18bfff;color:#04111f}
    #exionVoiceClose{background:#19304f;color:#fff}
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.id = 'exionVoiceOverlay';
  overlay.setAttribute('aria-hidden','true');
  overlay.innerHTML = `
    <section class="exionVoiceCard" role="dialog" aria-modal="true" aria-label="EXION Voz em tempo real">
      <div class="exionVoiceOrb" id="exionVoiceOrb">E</div>
      <h2 style="margin:0 0 6px">EXION Voz</h2>
      <div id="exionVoiceState">Conversa em tempo real.</div>
      <div id="exionVoiceText">Toque em iniciar e fale normalmente.</div>
      <div class="exionVoiceActions">
        <button id="exionVoiceListen" type="button">🎙️ Iniciar</button>
        <button id="exionVoiceClose" type="button">Encerrar</button>
      </div>
    </section>`;
  document.body.appendChild(overlay);
  $('#exionVoiceClose').addEventListener('click', closeVoiceMode);
  $('#exionVoiceListen').addEventListener('click', toggleLiveVoice);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeVoiceMode(); });
}

function setVoiceState(text, mode='idle') {
  const state=$('#exionVoiceState'), orb=$('#exionVoiceOrb');
  if(!state||!orb)return;
  state.textContent=text;
  orb.classList.toggle('listening',mode==='listening');
  orb.classList.toggle('speaking',mode==='speaking');
}

async function requestVoicePermission() {
  if (!navigator.mediaDevices?.getUserMedia) { toast('Seu navegador não oferece acesso ao microfone.'); return false; }
  try {
    const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    stream.getTracks().forEach(t=>t.stop());
    return true;
  } catch { toast('Permita o microfone para usar o EXION Voz.'); setVoiceState('Microfone bloqueado.'); return false; }
}

function wsUrl() {
  const proto=location.protocol==='https:'?'wss:':'ws:';
  return `${proto}//${location.host}/api/live-voice`;
}

function base64FromBytes(bytes){let binary='';const step=0x8000;for(let i=0;i<bytes.length;i+=step)binary+=String.fromCharCode(...bytes.subarray(i,i+step));return btoa(binary)}
function bytesFromBase64(b64){const bin=atob(b64),out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out}

function downsampleTo16k(float32, inputRate) {
  if (inputRate === 16000) return float32;
  const ratio=inputRate/16000;
  const length=Math.max(1,Math.round(float32.length/ratio));
  const result=new Float32Array(length);
  let offset=0;
  for(let i=0;i<length;i++){
    const next=Math.min(float32.length,Math.round((i+1)*ratio));
    let sum=0,count=0;
    for(let j=offset;j<next;j++){sum+=float32[j];count++}
    result[i]=count?sum/count:0;
    offset=next;
  }
  return result;
}

function pcm16Base64(float32){
  const pcm=new Int16Array(float32.length);
  for(let i=0;i<float32.length;i++){const x=Math.max(-1,Math.min(1,float32[i]));pcm[i]=x<0?x*32768:x*32767}
  return base64FromBytes(new Uint8Array(pcm.buffer));
}

function playLivePcm(b64) {
  if (!livePlaybackContext) livePlaybackContext=new (window.AudioContext||window.webkitAudioContext)();
  const bytes=bytesFromBase64(b64);
  if(bytes.length<2)return;
  const pcm=new Int16Array(bytes.buffer,bytes.byteOffset,Math.floor(bytes.byteLength/2));
  const buffer=livePlaybackContext.createBuffer(1,pcm.length,24000);
  const channel=buffer.getChannelData(0);
  for(let i=0;i<pcm.length;i++) channel[i]=pcm[i]/32768;
  const source=livePlaybackContext.createBufferSource();
  source.buffer=buffer; source.connect(livePlaybackContext.destination);
  const now=livePlaybackContext.currentTime;
  liveNextPlaybackTime=Math.max(liveNextPlaybackTime,now+0.02);
  source.start(liveNextPlaybackTime);
  liveNextPlaybackTime+=buffer.duration;
  liveSpeaking=true;
  setVoiceState('EXION está respondendo…','speaking');
  source.onended=()=>{if(livePlaybackContext && livePlaybackContext.currentTime>=liveNextPlaybackTime-0.05){liveSpeaking=false;if(voiceMode)setVoiceState('Pode falar.');}};
}

function stopLivePlayback(){
  liveNextPlaybackTime=livePlaybackContext?livePlaybackContext.currentTime:0;
  liveSpeaking=false;
  setVoiceState('Pode falar.');
}

async function startLiveMic(){
  if(liveMicStream||!liveSocket||liveSocket.readyState!==WebSocket.OPEN)return;
  liveMicStream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
  liveAudioContext=new (window.AudioContext||window.webkitAudioContext)();
  await liveAudioContext.resume();
  liveMicSource=liveAudioContext.createMediaStreamSource(liveMicStream);
  liveProcessor=liveAudioContext.createScriptProcessor(4096,1,1);
  liveProcessor.onaudioprocess=e=>{
    if(!liveSocket||liveSocket.readyState!==WebSocket.OPEN)return;
    const data=downsampleTo16k(e.inputBuffer.getChannelData(0),liveAudioContext.sampleRate);
    if(data.length)liveSocket.send(JSON.stringify({type:'audio',data:pcm16Base64(data)}));
  };
  liveMicSource.connect(liveProcessor); liveProcessor.connect(liveAudioContext.destination);
  setVoiceState('Conectado. Pode falar.');
  $('#exionVoiceListen').textContent='🔴 Encerrar microfone';
}

function stopLiveMic(){
  try{liveProcessor?.disconnect()}catch{} try{liveMicSource?.disconnect()}catch{}
  liveMicStream?.getTracks().forEach(t=>t.stop());
  try{liveAudioContext?.close()}catch{}
  liveProcessor=liveMicSource=liveMicStream=liveAudioContext=null;
  if ($('#exionVoiceListen')) $('#exionVoiceListen').textContent='🎙️ Iniciar';
}

function connectLive(){
  if(liveSocket && liveSocket.readyState<=1)return;
  setVoiceState('Conectando ao EXION em tempo real…');
  liveSocket=new WebSocket(wsUrl());
  liveSocket.onopen=()=>liveSocket.send(JSON.stringify({type:'auth',clientId:CLIENT_ID,password:sessionStorage.getItem(ACCESS_KEY)||''}));
  liveSocket.onmessage=async e=>{
    let msg;try{msg=JSON.parse(e.data)}catch{return}
    if(msg.type==='live_ready'){
      liveReady=true; setVoiceState('Conectado. Pode falar.');
      await startLiveMic().catch(err=>{setVoiceState('Não consegui abrir o microfone.');toast(err.message)});
      return;
    }
    if(msg.type==='auth_required')return;
    if(msg.type==='error'){setVoiceState(msg.error||'Erro na conexão.');toast(msg.error||'Erro na conexão de voz.');return;}
    const sc=msg.serverContent;
    if(!sc)return;
    if(sc.interrupted){stopLivePlayback();return;}
    if(sc.inputTranscription?.text){liveUserTranscript+=sc.inputTranscription.text;$('#exionVoiceText').textContent=liveUserTranscript;}
    if(sc.outputTranscription?.text){liveAssistantTranscript+=sc.outputTranscription.text;$('#exionVoiceText').textContent=liveAssistantTranscript;}
    const parts=sc.modelTurn?.parts||[];
    for(const part of parts){if(part.inlineData?.data)playLivePcm(part.inlineData.data)}
    if(sc.turnComplete){
      if(liveUserTranscript.trim())addBubble('user',liveUserTranscript.trim());
      if(liveAssistantTranscript.trim())addBubble('assistant',liveAssistantTranscript.trim());
      liveUserTranscript='';liveAssistantTranscript='';
      if(!liveSpeaking)setVoiceState('Pode falar.');
    }
  };
  liveSocket.onerror=()=>setVoiceState('Erro na conexão de voz.');
  liveSocket.onclose=()=>{liveReady=false;stopLiveMic();if(voiceMode)setVoiceState('Conexão encerrada. Toque em iniciar novamente.');};
}

async function openVoiceMode(){
  createVoiceUI(); voiceMode=true;
  const overlay=$('#exionVoiceOverlay');overlay.classList.add('open');overlay.setAttribute('aria-hidden','false');
  liveUserTranscript='';liveAssistantTranscript='';$('#exionVoiceText').textContent='Toque em iniciar e fale normalmente.';
  if(!(await requestVoicePermission()))return;
  connectLive();
}

async function toggleLiveVoice(){
  if(liveMicStream){stopLiveMic();setVoiceState('Microfone pausado. Toque em iniciar para voltar.');return;}
  if(!liveReady){connectLive();return;}
  try{await startLiveMic()}catch(e){toast(e.message)}
}

function closeVoiceMode(){
  voiceMode=false;stopLiveMic();stopLivePlayback();
  try{if(liveSocket&&liveSocket.readyState===WebSocket.OPEN)liveSocket.send(JSON.stringify({type:'close'}))}catch{}
  try{liveSocket?.close()}catch{} liveSocket=null;liveReady=false;
  const overlay=$('#exionVoiceOverlay');if(overlay){overlay.classList.remove('open');overlay.setAttribute('aria-hidden','true')}
}

createVoiceUI();
$('#callVoiceBtn')?.addEventListener('click',openVoiceMode);

function openDrawer() {
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  $('#closeMenu').focus();
}

function closeDrawer() {
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  $('#menuBtn').focus();
}

$('#sendBtn').addEventListener('click', ask);
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    ask();
  }
});
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
});

document.querySelectorAll('.chip[data-p]').forEach((button) => {
  button.addEventListener('click', () => {
    input.value = button.dataset.p;
    input.focus();
  });
});

$('#newBtn').addEventListener('click', () => {
  history = [];
  saveHistory();
  render();
  toast('Nova conversa criada. A memória e as conversas anteriores continuam guardadas.');
});
$('#menuBtn').addEventListener('click', openDrawer);
$('#closeMenu').addEventListener('click', closeDrawer);
$('#drawerBackdrop').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && drawer.classList.contains('open')) closeDrawer();
});
$('#mode').addEventListener('change', () => localStorage.setItem(MODE_KEY, $('#mode').value));
$('#refreshBackend').addEventListener('click', () => checkBackend(true));
$('#appPassword').value = sessionStorage.getItem(ACCESS_KEY) || '';
$('#saveAccess').addEventListener('click', () => {
  const password = $('#appPassword').value;
  if (password.length < 16) {
    toast('A senha de acesso precisa ter pelo menos 16 caracteres.');
    return;
  }
  sessionStorage.setItem(ACCESS_KEY, password);
  setStatus();
  toast('Senha de acesso guardada nesta sessão do navegador.');
});
$('#clearAccess').addEventListener('click', () => {
  sessionStorage.removeItem(ACCESS_KEY);
  $('#appPassword').value = '';
  setStatus();
  toast('Senha de acesso esquecida.');
});
$('#clearBtn').addEventListener('click', () => {
  history = [];
  localStorage.removeItem(HISTORY_KEY);
  render();
  closeDrawer();
  toast('Conversa e memória local apagadas.');
});
$('#testVoice').addEventListener('click', () => speak('Olá! Eu sou a EXION. A voz está funcionando no seu navegador.'));

$('#attachBtn').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    toast('Escolha uma imagem da galeria.');
    event.target.value = '';
    return;
  }
  if (file.size > 12 * 1024 * 1024) {
    toast('A imagem deve ter no máximo 12 MB.');
    event.target.value = '';
    return;
  }
  try {
    const dataUrl = await fileToDataUrl(file);
    selectedImage = { name: file.name, dataUrl };
    toast(`📷 ${file.name} pronta. Peça para a EXION analisar ou editar a foto.`);
    input.focus();
    if (!input.value.trim()) input.value = 'Descreva o que você vê nesta foto';
  } catch (error) {
    toast(error.message);
    event.target.value = '';
  }
});



function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Não consegui ler a imagem.'));
    reader.readAsDataURL(file);
  });
}

$('#micBtn').addEventListener('click', () => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    toast('Seu navegador não oferece reconhecimento de voz. Tente o Chrome.');
    return;
  }
  if (listening) {
    recognition.stop();
    return;
  }
  recognition = new SpeechRecognition();
  recognition.lang = 'pt-BR';
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.onstart = () => {
    listening = true;
    $('#micBtn').textContent = '⏹️';
    status.textContent = '🎙️ Ouvindo… fale agora';
  };
  recognition.onresult = (event) => {
    let transcript = '';
    for (const result of event.results) transcript += result[0].transcript;
    input.value = transcript;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  };
  recognition.onerror = (event) => {
    if (event.error === 'not-allowed') toast('Permissão do microfone negada. Libere o microfone nas configurações do navegador.');
    else toast('Não consegui ouvir. Tente novamente.');
  };
  recognition.onend = () => {
    listening = false;
    $('#micBtn').textContent = '🎙️';
    setStatus();
    if (input.value.trim()) ask();
  };
  recognition.start();
});

render();
checkBackend();
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      toast('Não foi possível ativar o modo instalável/offline.');
    });
  });
}
