import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { BrandShell } from "@/components/front/BrandShell";

export const metadata: Metadata = { title: "Privacy" };

/** Who runs the site and how to reach them (set in the hosting settings, so nothing personal is in the code). */
const CONTROLLER = process.env.NEXT_PUBLIC_CONTROLLER_NAME || "";
const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "";

export default function Privacy() {
  return (
    <BrandShell>
      <article className="fr-prose">
        <h1>Privacy</h1>
        <p className="fr-lead">
          {BRAND.name} is for golf events among friends, societies and clubs. Here is what it keeps about you, why, and how to have it removed. In plain words.
        </p>

        <h2>Who we are</h2>
        <p>
          {CONTROLLER ? `${BRAND.name} is run by ${CONTROLLER}, ` : `${BRAND.name} is run from Ireland, `}
          which decides how your information is used.{" "}
          {CONTACT ? (
            <>
              Write to <a href={`mailto:${CONTACT}`}>{CONTACT}</a> about anything on this page.
            </>
          ) : (
            <>
              To reach us about anything on this page, use the <Link href="/invite">request form</Link> and say it&apos;s about your data.
            </>
          )}
        </p>

        <h2>What we keep</h2>
        <ul>
          <li>
            <strong>Players:</strong> your name and handicap, which the organiser adds, and anything more you choose to share about yourself when you join. You
            say yes or no to each part. If the organiser adds your email, it&apos;s used to send you your link, and it only joins your account when you say it&apos;s you.
          </li>
          <li>
            <strong>Organisers, and anyone who signs in:</strong> your email address, used to sign you in (we send a link and a code, never a password) and to show
            your tournaments together. Old PINs are kept only in a scrambled form we can&apos;t read back.
          </li>
          <li>
            <strong>Followers:</strong> your name and email, so we can send you the link to sign in and the tournament&apos;s emails if you ask for them.
          </li>
          <li>
            <strong>The golf:</strong> scores, shots, notes, photos, video clips, comments and likes, and who added each one.
          </li>
          <li>
            <strong>Distances:</strong> when you tap GPS, your phone&apos;s position is used to measure to the green. We keep the distances and where you stood on the course
            for that shot, never a track of where you go. Clips keep where they were filmed only if your phone already allows this site your location.
          </li>
        </ul>
        <p>You must be 16 or over to join a tournament.</p>

        <h2>Who can see it</h2>
        <p>
          Only people you share a tournament&apos;s link with. There&apos;s no search for tournaments on this site, and tournament pages are kept out of search
          engines like Google.
        </p>

        <h2>Why</h2>
        <p>
          To run your tournament: the scoring, the leaderboard, the feed, the match reports, the emails you asked for and the highlights film. We don&apos;t sell
          anything about you, show adverts, or use it for anything else.
        </p>

        <h2>Who helps us run it</h2>
        <p>
          A few services do part of the work for us and see only what that part needs: hosting the site, storing the data and files, sending email, writing the
          previews and match reports (an AI service), recording commentary and turning speech into text, and putting the films together. Weather and course details
          come from services that never see anything about you. Some of these services are based outside the EU.
        </p>

        <h2>Cookies</h2>
        <p>Only the ones that keep you signed in. No tracking or advertising cookies, so there&apos;s nothing to accept.</p>

        <h2>How long</h2>
        <p>
          A tournament and everything in it are kept until its organiser deletes it, or until you ask us to remove what&apos;s about you. Every email we send has a
          one-tap unsubscribe.
        </p>

        <h2>Your rights</h2>
        <p>
          You can ask to see what we have about you, to correct it, or to delete it, and you can object to how we use it. We&apos;ll answer within a month. If
          you&apos;re not happy with our answer, you can complain to Ireland&apos;s <a href="https://www.dataprotection.ie">Data Protection Commission</a>.
        </p>

        <p className="fr-quiet">Last updated 16 October 2026.</p>
      </article>
    </BrandShell>
  );
}
