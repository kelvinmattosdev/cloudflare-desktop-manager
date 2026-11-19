# Histórico de versões do NimboDesk

## [1.0.1](https://github.com/kelvinmattosdev/cloudflare-desktop-manager/releases/tag/v1.0.1) · 2026-11-19

- A nuvem azul passa a ser o ícone do app. O laranja continua indicando proxy ativo da Cloudflare.
- A engrenagem no canto superior direito abre as Configurações. Em Aparência, dá para seguir o tema do sistema ou escolher Claro ou Escuro. A escolha é lembrada ao reabrir o app.
- O contraste de textos, controles e indicadores foi revisado nos dois temas.
- No Linux, o comando `nimbodesk` abre o app. A busca do menu encontra o mesmo atalho por NimboDesk, DNS ou DNS Console.
- Ao reabrir depois de atualizar pelo app, o modal mostra o que mudou em cada versão incluída e destaca as correções de segurança.
- Primeiro `.dmg` universal experimental para macOS, ainda não testado, sem Developer ID ou notarização.

## [1.0.0](https://github.com/kelvinmattosdev/cloudflare-desktop-manager/releases/tag/v1.0.0) · 2026-11-18

- Primeira versão pública. O app lista os domínios liberados pelo token da Cloudflare e permite buscar, adicionar, editar e excluir registros DNS. Também dá para ajustar TTL, proxy e comentários.
- Modo demonstração com domínios fictícios. Quando há um cofre disponível, o app pode lembrar o token.
- Verificação de atualizações pelo GitHub ao abrir o app, com opção de checar novamente e instalar pelo aplicativo.
- Instaladores para Linux (`.deb` e AppImage) e Windows (`.exe`). O macOS ficou marcado como não testado, sem instalador nesta release.
