# EXION V6 — pronto para publicar no Render

## O que você precisa fazer

Você só precisa colocar estes arquivos em um repositório GitHub e conectar esse repositório ao Render.

### 1. Criar/abrir o repositório
- Entre no GitHub.
- Crie um repositório, por exemplo: `exion-ai`.
- Envie TODOS os arquivos desta pasta para a raiz do repositório.
- Não envie nenhum arquivo `.env` com chaves reais.

### 2. No Render
- Entre no Render.
- Clique em **New +** → **Blueprint**.
- Selecione o repositório GitHub do EXION.
- O Render vai detectar o arquivo `render.yaml`.
- Confirme a criação do serviço `exion-ai`.

### 3. Chave do Gemini
Durante a configuração, preencha `GEMINI_API_KEY` com a sua chave do Gemini.

O `render.yaml` já configura:
- `AI_PROVIDER=gemini`
- `GEMINI_MODEL=gemini-4-argon`
- `GEMINI_LIVE_ENABLED=true`
- `GEMINI_LIVE_MODEL=gemini-3.8-live`
- `GEMINI_LIVE_VOICE=Orus`
- busca do Gemini ativada
- URL Context ativado
- senha de acesso gerada automaticamente
- servidor ouvindo em `0.0.0.0`

### 4. Depois do deploy
Abra o endereço `https://SEU-SERVICO.onrender.com`.

Teste:
1. Faça uma pergunta normal.
2. Veja se aparece o botão **📞 Voz** ao lado do microfone.
3. Toque em **📞 Voz**.
4. Autorize o microfone.
5. Teste a conversa por voz.
6. Abra `https://SEU-SERVICO.onrender.com/api/health` e confira se `provider` é `gemini` e `liveVoice` é `true`.

## Se o endereço antigo continuar mostrando a interface velha
Isso significa que o serviço antigo está ligado a outro repositório/branch ou ainda não recebeu um novo deploy.

No serviço antigo do Render:
- abra **Settings** → **Build & Deploy**;
- confira o repositório e a branch;
- confirme que a raiz do projeto contém `render.yaml`, `package.json`, `index.html`, `app.js` e `server.js`;
- faça um novo deploy.

## Importante
- O APK/AAB incluído neste pacote NÃO é reconstruído automaticamente quando o site muda.
- O botão de voz desta versão pertence à interface web publicada pelo Render.
- Não coloque chaves de API dentro de `app.js`, `index.html` ou no APK.
