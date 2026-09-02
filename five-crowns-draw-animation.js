(function () {
  const originalSend = window.send;
  if (typeof originalSend !== "function") return;

  const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  async function animateDraw(origin) {
    const target = document.querySelector("#humanHand .card.drawn");
    if (!origin || !target) return;

    const start = origin.getBoundingClientRect();
    const end = target.getBoundingClientRect();
    const clone = origin.cloneNode(true);
    clone.removeAttribute("id");
    clone.classList.remove("actionable", "selected", "drawn", "discard-top");
    clone.classList.add("draw-flight");
    Object.assign(clone.style, { left: `${start.left}px`, top: `${start.top}px`, width: `${start.width}px`, height: `${start.height}px` });

    target.style.visibility = "hidden";
    document.body.append(clone);
    const dx = end.left + end.width / 2 - (start.left + start.width / 2);
    const dy = end.top + end.height / 2 - (start.top + start.height / 2);
    const duration = prefersReducedMotion() ? 120 : 390;
    try {
      await clone.animate([
        { transform: "translate(0,0) scale(1) rotate(0deg)", opacity: 1 },
        { transform: `translate(${dx}px,${dy}px) scale(.9) rotate(-4deg)`, opacity: .97 }
      ], { duration, easing: "cubic-bezier(.22,.8,.25,1)", fill: "forwards" }).finished;
    } catch (_) {
      // Animation cancellation should still reveal the selected card.
    } finally {
      clone.remove();
      target.style.visibility = "";
    }
  }

  window.send = async function (action) {
    const isDraw = action?.action === "draw";
    const source = isDraw ? document.getElementById(action.source === "discard" ? "discardPile" : "stockPile") : null;
    await originalSend(action);
    if (isDraw) await animateDraw(source);
  };
}());
