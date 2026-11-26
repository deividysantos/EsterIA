export function EmBreve({ titulo, texto, fase }: { titulo: string; texto: string; fase?: string }) {
  return (
    <section>
      <header className="cabecalho">
        <h1>{titulo}</h1>
        {fase && <span className="selo">Fase {fase}</span>}
      </header>
      <p className="vazio">{texto}</p>
    </section>
  );
}
