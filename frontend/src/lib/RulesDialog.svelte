<script lang="ts">
  /**
   * The rules of two-player Quoridor, as this app actually enforces them.
   * (The physical game also has a four-player variant; nothing here plays it.)
   *
   * Board size, wall count and the step cap come from the chosen model, so the
   * text matches the game in front of the player rather than the standard 9×9.
   */
  let { open, boardSize, maxWalls, maxSteps, onclose }: {
    open: boolean;
    boardSize: number;
    maxWalls: number;
    maxSteps: number;
    onclose: () => void;
  } = $props();

  // A native <dialog> gets Esc-to-close, focus trapping and the backdrop for
  // free; this keeps its open state in step with the prop, and its own onclose
  // (Esc, or the button) tells the parent so the two never disagree.
  let el = $state<HTMLDialogElement | null>(null);
  let body = $state<HTMLElement | null>(null);
  $effect(() => {
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      // The element is reused, so it would otherwise open wherever the last
      // reader left it -- which reads as a broken dialog, not a saved place.
      if (body) body.scrollTop = 0;
    } else if (!open && el.open) el.close();
  });
</script>

<dialog bind:this={el} onclose={onclose}>
  <article bind:this={body}>
    <h2>How to play</h2>

    <p class="lede">
      Quoridor for two. Each player has one pawn and {maxWalls}
      {maxWalls === 1 ? "wall" : "walls"}, on a {boardSize}×{boardSize} board.
    </p>

    <h3>Winning</h3>
    <p>
      You are the blue pawn at the bottom, and you win by reaching <em>any</em>
      square on the top row. The AI is red, starts opposite you, and wants any
      square on your home row. Nobody has to be captured or blocked — it is a
      race.
    </p>

    <h3>Your turn</h3>
    <p>
      Do exactly one of two things: move your pawn, or place a wall. There is no
      passing.
    </p>

    <h3>Moving</h3>
    <p>
      One square up, down, left or right — never diagonally, never through a
      wall, never off the board. Squares you may move to are marked with a green
      dot; click one.
    </p>

    <h3>Jumping</h3>
    <p>
      If the other pawn is directly next to yours, you may jump straight over it
      to the square beyond. If that square is blocked — by a wall or by the edge
      of the board — you may instead step diagonally to either square beside it.
      The AI plays by the same rule.
    </p>

    <h3>Walls</h3>
    <p>
      A wall is two squares long and sits in the groove between squares, either
      flat or upright. Hover a groove to preview the wall, then click to place
      it. Walls block both players equally, and may not overlap or cross a wall
      that is already down. Once you are out of walls, every turn is a move.
    </p>

    <h3>The rule that makes it a game</h3>
    <p>
      You may never place a wall that leaves either player with no route at all
      to their goal row. Sending someone the long way round is the whole point;
      sealing them in is illegal — the board simply will not offer you that
      wall.
    </p>

    <h3>Draws</h3>
    <p>
      If neither pawn gets home within {maxSteps} moves, the game is a draw.
      That is a safety net for the AI, not something a real game tends to reach.
    </p>
  </article>

  <button onclick={onclose}>Close</button>
</dialog>

<style>
  /* Column layout so the text is the only thing that scrolls: sizing the
     article against the viewport instead left the dialog with a scrollbar of
     its own next to the article's. */
  dialog[open] { display: flex; }
  dialog {
    flex-direction: column;
    max-width: 34rem;
    max-height: 80vh;
    padding: 0;
    border: 1px solid #c9b48a;
    border-radius: 10px;
    background: #fffaf1;
    color: inherit;
  }
  dialog::backdrop { background: rgba(43, 26, 12, 0.55); }
  article {
    min-height: 0;
    overflow-y: auto;
    padding: 20px 20px 0;
  }
  h2 { margin: 0 0 4px; font-size: 1.3rem; }
  h3 { margin: 16px 0 2px; font-size: 0.95rem; }
  p { margin: 0; font-size: 0.9rem; line-height: 1.5; }
  .lede { color: #6b5a3f; }
  button {
    font: inherit;
    align-self: flex-start;
    margin: 12px 20px 16px;
    padding: 6px 14px;
    border: 1px solid #c9b48a;
    border-radius: 6px;
    background: #fff;
    cursor: pointer;
  }
  button:hover { background: #f3e9d6; }
</style>
