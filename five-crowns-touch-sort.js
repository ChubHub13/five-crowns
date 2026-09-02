/* Give the desktop hand-sorting gesture a touch equivalent on tablets. */
(function () {
  const hand = document.getElementById("humanHand");
  if (!hand || !window.PointerEvent) return;

  let activePointer = null;
  const mouseEvent = (type, pointer) => new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: pointer.clientX,
    clientY: pointer.clientY,
    button: 0,
    buttons: type === "mouseup" ? 0 : 1
  });

  hand.addEventListener("pointerdown", event => {
    if (event.pointerType !== "touch") return;
    const card = event.target.closest("button.card");
    if (!card || card.parentElement !== hand) return;
    event.preventDefault();
    activePointer = event.pointerId;
    card.setPointerCapture?.(event.pointerId);
    card.dispatchEvent(mouseEvent("mousedown", event));
  }, { passive: false });

  document.addEventListener("pointermove", event => {
    if (event.pointerId !== activePointer) return;
    event.preventDefault();
    document.dispatchEvent(mouseEvent("mousemove", event));
  }, { passive: false });

  const finish = event => {
    if (event.pointerId !== activePointer) return;
    event.preventDefault();
    document.dispatchEvent(mouseEvent("mouseup", event));
    activePointer = null;
  };
  document.addEventListener("pointerup", finish, { passive: false });
  document.addEventListener("pointercancel", finish, { passive: false });
}());
