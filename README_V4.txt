EXION V4 — INTERNET + WEB SEARCH + GITHUB + TERMINAL SEGURO

O backend desta versão foi preparado para:
- responder pelo endpoint /api/chat usando OpenRouter;
- pesquisar na web por resultados atuais;
- abrir páginas públicas HTTP/HTTPS;
- pesquisar repositórios públicos do GitHub;
- ler arquivos/conteúdo de repositórios públicos do GitHub;
- executar diagnósticos controlados no terminal do servidor.

TERMINAL
O terminal NÃO é irrestrito. Por segurança, a IA só pode chamar estes comandos sem argumentos arbitrários:
pwd, ls, node, npm, git, whoami, date.

Isso permite diagnosticar o servidor sem dar à IA acesso irrestrito ao sistema operacional.

CONFIGURAÇÃO
1. Instale Node.js 20 ou superior.
2. Copie .env.example para .env.
3. Coloque sua chave OpenRouter em OPENROUTER_API_KEY.
4. Defina EXION_ACCESS_PASSWORD com uma senha forte para produção.
5. Rode: npm install
6. Rode: npm start

IMPORTANTE
A chave da IA deve ficar somente no backend. Não coloque a chave dentro do APK.
O APK incluído neste pacote não foi recompilado. Para o APK usar as novas funções, ele precisa apontar para o backend publicado ou ser recompilado/configurado com a URL pública do backend.

INTERNET
A pesquisa web usa um serviço público de resultados e o EXION também pode abrir URLs públicas. Não é garantido acesso a sites que exigem login, CAPTCHA, bloqueios regionais ou permissões privadas.

GITHUB
O acesso implementado é para conteúdo público. Repositórios privados exigem autenticação adicional no servidor.


EXION V4.1 — MEMÓRIA PERSISTENTE

- O EXION agora recebe um ID anônimo por navegador para associar conversas e memórias ao mesmo usuário.
- O backend guarda o histórico no arquivo data/memory.json.
- A IA pode usar a ferramenta remember para salvar preferências, objetivos, decisões e informações duradouras úteis para o futuro.
- A busca de memórias relevantes é feita antes de cada resposta.
- As conversas antigas não são apagadas pelo botão “Nova conversa”; o servidor continua com o histórico.
- Para respostas mais rápidas, o modelo recebe as últimas mensagens + memórias relevantes, em vez de reenviar todo o histórico a cada pergunta.
- A memória não deve guardar senhas, chaves, dados financeiros ou informações sensíveis.
- A EXION não tem “memória infinita”: há limites técnicos para armazenamento e contexto enviado ao modelo, mas o histórico fica persistido no servidor.


EDIÇÃO DE IMAGENS
- O botão de anexo abre a galeria do dispositivo e aceita PNG/JPG/WebP até 12 MB.
- Depois de selecionar a foto, escreva o que quer mudar e toque em Enviar.
- O backend usa /api/image-edit. Para funcionar, configure IMAGE_API_URL, IMAGE_API_KEY e IMAGE_MODEL no .env com um provedor de edição de imagens compatível.
- A chave do provedor fica somente no servidor; não coloque chaves dentro do APK.


NOVO — EXION COM VISÃO E IMAGENS

A versão atual pode:
- receber uma foto da galeria (PNG/JPG/JPEG/WebP até 12 MB);
- analisar a foto e responder o que aparece nela;
- editar a foto conforme um pedido, por exemplo mudar fundo, remover/adicionar elementos ou melhorar a imagem;
- criar uma nova imagem quando o usuário pedir algo como “crie uma imagem de...”
- continuar usando memória, internet, GitHub e terminal seguro.

COMO FUNCIONA
1. Toque no botão de anexar e escolha uma foto.
2. Para entender a foto, escreva algo como “o que aparece aqui?” ou “descreva esta imagem”.
3. Para editar, use palavras como “edite”, “mude”, “remova”, “adicione” ou “troque”.
4. Para criar, basta pedir diretamente “crie uma imagem de...”.

CONFIGURAÇÃO
- OPENAI_API_KEY: chave do provedor de IA usada para visão e, se IMAGE_API_KEY não estiver definida, também para criação/edição.
- OPENAI_BASE_URL: normalmente https://api.openai.com/v1.
- VISION_MODEL: modelo compatível com entrada de imagem.
- IMAGE_MODEL: modelo de geração/edição de imagens disponível na sua conta.
- IMAGE_API_URL e IMAGE_API_KEY continuam aceitos para um provedor separado de imagens.

IMPORTANTE
As chaves ficam no servidor e não devem ser colocadas no JavaScript do navegador ou dentro do APK. A geração e a análise de imagens podem consumir créditos do provedor.

O APK/AAB que veio no pacote continua sendo o binário antigo. Para ter essas funções dentro do APK instalado, é necessário recompilar o APK com o projeto Android/WebView atualizado.


EXION V4 — CAMADA DE CAPACIDADES
- Raciocínio interno sem expor cadeia de pensamento privada.
- Pesquisa e leitura da web, GitHub público e terminal seguro.
- Memória duradoura e consulta de histórico arquivado.
- Data/hora atual e verificação de informações.
- Visão de imagens, geração e edição de imagens.
- O modelo de IA continua sendo fornecido por um provedor configurado no backend; o EXION não copia nem expõe modelos ou instruções internas proprietárias.


=== Modo Gemini / inteligência avançada ===
O backend agora pode usar Gemini como motor alternativo. Defina AI_PROVIDER=gemini e GEMINI_API_KEY no .env.
Configurações adicionadas: nível de thinking (low/medium/high), Google Search, URL Context, Code Execution opcional, Structured Output opcional, temperatura, limite de saída e seleção do modelo. O EXION continua com memória, histórico, web, GitHub e terminal controlado.

Observação: recursos do Gemini dependem do modelo e da conta/API disponíveis. A chave fica somente no backend e não deve ser colocada no APK.

=== EXION VOZ ===
A interface agora possui uma aba/botão “EXION Voz”. Ao entrar no modo de voz, o navegador pede permissão para o microfone. Depois, o usuário pode falar uma pergunta, o EXION envia a pergunta ao mesmo backend de IA e lê a resposta automaticamente.

- Reconhecimento de fala: Web Speech API do navegador.
- Voz: SpeechSynthesis do dispositivo/navegador, com ajuste para uma voz mais grave e cadenciada, inspirada em assistentes de ficção científica.
- Não é uma cópia da voz do JARVIS nem usa a voz de um ator específico.
- O recurso precisa de um navegador compatível e, para respostas reais, do backend configurado.
- O botão “EXION Voz” é criado pela interface, então não exige um novo arquivo HTML para a função básica.


MODO EXION VOZ REAL-TIME
- Usa a Gemini Live API por WebSocket para áudio bidirecional em tempo real.
- O navegador transmite PCM do microfone e recebe PCM de voz do modelo.
- Há detecção automática de fim/início de fala e interrupção (barge-in).
- GEMINI_LIVE_MODEL padrão: gemini-3.8-live.
- GEMINI_LIVE_VOICE padrão: Orus.
- A voz é uma voz sintética de assistente; não é uma cópia da voz do JARVIS.
- A chave Gemini fica somente no servidor.

EXION V6 — pacote unificado
- Mantém inteligência Gemini, thinking, pesquisa web, URL context, GitHub, terminal seguro, memória, histórico e visão/imagens.
- Modo EXION Voz em tempo real com Gemini Live, microfone e orb flutuante.
- Botão de ligação ao lado do microfone na barra de mensagem.
- Ícone de engrenagem EXION incluído em assets/exion-icon.png e usado na interface.
- O APK/AAB incluído é o artefato nativo anterior; para colocar estas mudanças dentro do APK instalado, é necessário recompilar a camada Android/WebView/TWA a partir de um projeto Android/TWA correspondente.

---
RENDER

Este pacote contém render.yaml e RENDER_PRONTO.md para publicar a versão V6 no Render.
O servidor deve usar HOST=0.0.0.0 em produção. A chave GEMINI_API_KEY deve ser cadastrada como variável de ambiente no Render e nunca colocada no código.
