# DNS Console

Aplicativo desktop não oficial, em português, exclusivamente para registros DNS da Cloudflare.

## Instalar no Zorin OS / Ubuntu (64 bits)

Baixe o `.deb` na página de [Releases](https://github.com/kelvinmattosdev/dns-console/releases/latest). Abra-o pelo instalador gráfico ou, a partir da pasta onde baixou o arquivo, execute:

```sh
sudo apt install ./dns-console_1.0.0_amd64.deb
```

Depois, procure **DNS Console** no menu de aplicativos.

Como alternativa ao `.deb`, baixe o **AppImage** da mesma release, marque-o como executável (`chmod +x dns-console_1.0.0_amd64.AppImage`) e abra-o numa pasta do seu usuário. O AppImage é portátil e não instala um atalho automaticamente.

## Atualizações

Ao abrir o `.deb` instalado ou o AppImage, o DNS Console consulta a última [release estável no GitHub](https://github.com/kelvinmattosdev/dns-console/releases). O topo mostra **Atualizado vX.Y.Z** ou **Atualizar para vX.Y.Z**. O ícone ao lado permite **Checar atualizações** novamente. A pesquisa não usa nem envia o token da Cloudflare ao GitHub.

O download só começa ao clicar em **Atualizar**. O app confere o tamanho e o SHA-256 divulgado pelo GitHub. Se a instalação for bem-sucedida, o app reabre na nova versão. Na instalação via `.deb`, o Zorin pede autorização de administrador. O AppImage pode ser substituído sem `sudo` quando está em uma pasta sua.

## Conectar

1. Em [API Tokens](https://dash.cloudflare.com/profile/api-tokens/), crie um token de usuário (modelo **Edit zone DNS**).
2. Confira as permissões **Zone → Zone → Read** e **Zone → DNS → Edit**. Em **Zone Resources**, inclua todos os domínios desejados ou limite a domínios específicos.
3. Cole o token no app. Não use a Global API Key. Use **Abrir demonstração** para testar sem credencial e sem chamadas à Cloudflare.

O app consulta todas as páginas de domínios autorizados pela API e as páginas de registros do domínio selecionado. A API impõe um limite de 500 contas por listagem de zonas. A interface inclui busca, filtro por tipo, inclusão, edição, exclusão individual com confirmação, proxy, TTL e comentários. Na edição o tipo é fixo; tipos avançados usam os campos estruturados da API. O app não altera configurações de CDN, segurança, DNSSEC ou encaminhamentos.

O token fica na memória por padrão. **Lembrar token** usa o cofre do sistema (via Electron `safeStorage`); quando só há armazenamento inseguro no Linux, a opção fica indisponível. **Desconectar** apaga o token salvo da sessão real. Nenhuma operação de escrita é repetida automaticamente.

## Desenvolvimento local

Requer Node.js 22 ou superior. Os instaladores são gerados em `dist/` e não fazem parte do código versionado.

```sh
npm ci
npm test
npm run test:desktop
npm start
npm run package
```

O teste desktop usa a sessão de demonstração em um perfil temporário e requer ambiente gráfico Linux. Nenhum teste usa credencial ou redes de produção.

### Como preparar uma release futura

1. Para uma nova versão, atualize `package.json` e `package-lock.json` juntos (por exemplo, `npm version patch --no-git-tag-version`).
2. Rode os testes e `npm run package`. Esse comando gera os instaladores localmente e não publica nada.
3. Quando for publicar, use a tag `vX.Y.Z` no commit correspondente, marque a release pública como estável e mais recente e anexe `dns-console_X.Y.Z_amd64.deb` e `dns-console_X.Y.Z_amd64.AppImage` sem renomeá-los.
4. Confirme que ambos os anexos aparecem em `GET /releases/latest` com o digest SHA-256. O atualizador usa esses dados para reconhecer e verificar o download.

Referências oficiais: [API Tokens](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/), [List Zones](https://developers.cloudflare.com/api/resources/zones/methods/list/), [DNS Records](https://developers.cloudflare.com/api/resources/dns/subresources/records/).
