# NimboDesk

Precisa trocar um IP, apontar um subdomínio ou conferir um TXT? O NimboDesk é um app de Linux para mexer no DNS da Cloudflare sem abrir o painel no navegador. Escolha um domínio na barra lateral e use a busca ou o filtro por tipo para achar o registro.

Você pode adicionar, editar e excluir registros, ajustar o TTL e ligar ou desligar o proxy nos tipos que aceitam essa opção. O app pede confirmação antes de excluir. Por enquanto, o NimboDesk cuida só dos registros DNS. É um projeto independente, sem vínculo com a Cloudflare.

## Instalar no Zorin OS ou Ubuntu (64 bits)

Baixe o `.deb` na página de [releases](https://github.com/kelvinmattosdev/cloudflare-desktop-manager/releases/latest). Abra pelo instalador gráfico ou rode isto na pasta onde salvou o arquivo:

```sh
sudo apt install ./nimbodesk_1.0.0_amd64.deb
```

Depois, procure NimboDesk no menu de aplicativos.

Prefere rodar sem instalar? Baixe o AppImage da mesma release, dê permissão de execução com `chmod +x nimbodesk_1.0.0_amd64.AppImage` e abra o arquivo. Ele não cria atalho no menu.

## Conectar à Cloudflare

Se quiser ver como funciona antes de conectar sua conta, clique em "Abrir demonstração". Os domínios são fictícios e nenhuma alteração chega à Cloudflare.

1. Na página [API Tokens](https://dash.cloudflare.com/profile/api-tokens/) da Cloudflare, crie um token de usuário com o modelo `Edit zone DNS`.
2. Confira se o token tem `Zone → Zone → Read` e `Zone → DNS → Edit`. Em `Zone Resources`, selecione os domínios que quer gerenciar.
3. Cole o token no NimboDesk. Use o API Token, não a Global API Key.

O app lista os domínios que a Cloudflare libera para o token. Por padrão, o token vale só para a sessão do app. A opção "Lembrar token" só fica disponível quando dá para usar o cofre do sistema. Se clicar em "Desconectar" na sessão da Cloudflare, o app apaga a cópia salva.

## Atualizar o app

Ao abrir, o app consulta a última versão estável no GitHub sem enviar o token da Cloudflare. O ícone de atualizar no topo serve para checar de novo. Se aparecer "Atualizar para vX.Y.Z", clique no botão para baixar e instalar. O NimboDesk verifica o tamanho e o SHA-256 do arquivo antes de instalar e reabre se der tudo certo.

O `.deb` pede autorização de administrador. O AppImage pode se atualizar sem `sudo` se estiver em uma pasta onde você pode gravar.

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
npm run package
```

O teste desktop precisa de um ambiente gráfico Linux. Ele usa o modo demonstração e um perfil temporário. Os testes simulam as respostas da Cloudflare e do GitHub.

### Preparar uma release

Para subir a versão, use `npm version patch --no-git-tag-version` ou escolha `minor` ou `major`. Rode os testes e gere os instaladores com `npm run package`. Os arquivos ficam em `dist/`; o comando não publica nada.

Na hora de publicar, crie a tag `vX.Y.Z` no commit da versão. Anexe `nimbodesk_X.Y.Z_amd64.deb` e `nimbodesk_X.Y.Z_amd64.AppImage` sem renomear os arquivos. Marque a release como estável e mais recente. Confira se os dois anexos aparecem com o SHA-256 em `GET /releases/latest`, que é de onde o app lê a versão e verifica o download.

Documentação da Cloudflare: [criar um token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) e [API de registros DNS](https://developers.cloudflare.com/api/resources/dns/subresources/records/).
