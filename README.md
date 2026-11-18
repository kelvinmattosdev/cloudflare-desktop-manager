# NimboDesk

Precisa trocar um IP, apontar um subdomínio ou conferir um TXT? O NimboDesk é um app para Windows, macOS e Linux para mexer no DNS da Cloudflare sem abrir o painel no navegador. Escolha um domínio na barra lateral e use a busca ou o filtro por tipo para achar o registro.

Você pode adicionar, editar e excluir registros, ajustar o TTL e ligar ou desligar o proxy nos tipos que aceitam essa opção. O app pede confirmação antes de excluir. Por enquanto, o NimboDesk cuida só dos registros DNS. É um projeto independente, sem vínculo com a Cloudflare.

## Instalar

Baixe o arquivo do seu sistema na página de [releases](https://github.com/kelvinmattosdev/cloudflare-desktop-manager/releases/latest):

| Sistema | Arquivo | Como abrir |
| --- | --- | --- |
| Windows 64 bits | `.exe` | Rode o instalador e procure NimboDesk no menu Iniciar. |
| macOS, Intel e Apple Silicon | `.dmg` | Abra a imagem e arraste NimboDesk para Aplicativos. |
| Linux 64 bits, Zorin OS ou Ubuntu | `.deb` | Abra pelo instalador gráfico ou use o comando abaixo. |
| Linux 64 bits, versão portátil | `.AppImage` | Marque o arquivo como executável e abra. Ele não cria atalho no menu. |

Para instalar o `.deb` pelo terminal, vá até a pasta onde salvou o arquivo:

```sh
sudo apt install ./nimbodesk_1.0.0_amd64.deb
```

Depois, procure NimboDesk no menu de aplicativos.

No AppImage, use `chmod +x nimbodesk_1.0.0_amd64.AppImage` para dar permissão de execução, se for preciso.

## Conectar à Cloudflare

Se quiser ver como funciona antes de conectar sua conta, clique em "Abrir demonstração". Os domínios são fictícios e nenhuma alteração chega à Cloudflare.

1. Na página [API Tokens](https://dash.cloudflare.com/profile/api-tokens/) da Cloudflare, crie um token de usuário com o modelo `Edit zone DNS`.
2. Confira se o token tem `Zone → Zone → Read` e `Zone → DNS → Edit`. Em `Zone Resources`, selecione os domínios que quer gerenciar.
3. Cole o token no NimboDesk. Use o API Token, não a Global API Key.

O app lista os domínios que a Cloudflare libera para o token. Por padrão, o token vale só para a sessão do app. A opção "Lembrar token" só fica disponível quando dá para usar o cofre do sistema. Se clicar em "Desconectar" na sessão da Cloudflare, o app apaga a cópia salva.

## Atualizar o app

Ao abrir, o app consulta a última versão estável no GitHub sem enviar o token da Cloudflare. O ícone de atualizar no topo serve para checar de novo. Se aparecer "Atualizar para vX.Y.Z", clique no botão para baixar e instalar. O NimboDesk verifica o tamanho e o SHA-256 do arquivo antes de instalar e reabre se der tudo certo.

No Linux, o `.deb` pede autorização de administrador. O AppImage pode se atualizar sem `sudo` se estiver em uma pasta onde você pode gravar. No Windows, o app usa o instalador `.exe`. No macOS, a atualização pelo app exige uma cópia assinada com Developer ID e instalada fora do `.dmg`; nas versões de teste sem essa assinatura, o botão abre a página de releases.

## Rodar a partir do código

Use Node.js 22 ou mais recente:

```sh
npm ci
npm start
```

Para rodar os testes ou gerar os instaladores:

```sh
npm test
npm run test:desktop
npm run package:linux
npm run package:win
npm run package:mac:unsigned
```

O teste desktop precisa de um ambiente gráfico. Ele usa o modo demonstração e um perfil temporário. Os testes simulam as respostas da Cloudflare e do GitHub. Para gerar o `.dmg` e o `.zip`, rode o comando do macOS em um Mac. O instalador do Windows pode ser gerado no Windows ou no Linux com Wine.

### Preparar uma release

Para subir a versão, use `npm version patch --no-git-tag-version` ou escolha `minor` ou `major`. Rode os testes e gere os instaladores. Os arquivos ficam em `dist/linux/`, `dist/windows/` e `dist/macos/`. Os comandos `package:*` não publicam nada.

O workflow [Gerar instaladores](.github/workflows/build.yml) roda manualmente no GitHub Actions e guarda os arquivos da compilação. Ele não cria a release. Sem certificado, o instalador Windows é gerado sem assinatura e pode receber um aviso do SmartScreen. Para assinar no workflow, configure `WINDOWS_CERTIFICATE_BASE64` e `WINDOWS_CERTIFICATE_PASSWORD`.

Para publicar no macOS, use um certificado Developer ID Application e notarize o app pela Apple. No workflow, marque `sign_macos` e configure `MAC_CERTIFICATE_BASE64`, `MAC_CERTIFICATE_PASSWORD`, `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID` e `APPLE_API_ISSUER` nos segredos do GitHub. Os arquivos gerados sem essas credenciais são para teste.

Na hora de publicar, crie a tag `vX.Y.Z` no commit da versão. Anexe os instaladores e mantenha os nomes originais. Junto com eles, envie `latest.yml` (Windows), `latest-mac.yml` e o `.zip` universal (macOS). Marque a release como estável e mais recente. Confira se os anexos aparecem com o SHA-256 em `GET /releases/latest`, que é de onde o app lê a versão e verifica o download.

Documentação da Cloudflare: [criar um token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) e [API de registros DNS](https://developers.cloudflare.com/api/resources/dns/subresources/records/).
