export default function Rules() {
  return (
    <article className="article" style={{ maxWidth: 760 }}>
      <h2>The rules</h2>
      <div className="byline">As agreed, October 2026</div>
      <p>
        Seven rounds, head to head. The site keeps points only. Money is settled separately.
      </p>
      <h3>Rounds</h3>
      <p>
        Every round has a front nine worth 10 points, a back nine worth 10 points and the full 18 worth 20 points in
        Rounds 1–4, 30 in Rounds 5–6 and 40 in Round 7. A halved nine or 18 splits its points.
      </p>
      <p>
        <strong>Stableford</strong> (R1, R2, R4): more points wins. <strong>Stroke play</strong> (R3, R7): fewer net
        strokes wins. <strong>Match play</strong> (R5, R6): more holes won wins. Every match is played out to the 18th.
      </p>
      <h3>Handicaps</h3>
      <p>
        Set per round. Some rounds are flat (off scratch); others give shots, taken on the holes with the lowest
        stroke index first.
      </p>
      <h3>Side games, across the whole trip</h3>
      <p>
        <strong>Closest to the pin</strong> on every par 3, ball must finish on the green: most won takes 10 points.{" "}
        <strong>Long drive</strong> on every par 5, ball must finish on the fairway: most won takes 10 points. If both
        miss, nobody wins that hole. <strong>Greens in regulation</strong> on every hole: most hit takes 20 points. A
        tie on any of these splits the points.
      </p>
      <h3>Birdies and eagles</h3>
      <p>Gross only. Kept as a separate tally, with no points attached.</p>
      <h3>Total</h3>
      <p>360 points available: 320 from the rounds and 40 from the side games.</p>
    </article>
  );
}
