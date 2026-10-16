import { redirect } from "next/navigation";

/** The new front page was looked at here before it went live: old links go to the front page. */
export default function Preview() {
  redirect("/");
}
