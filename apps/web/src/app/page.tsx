import Link from "next/link";

export default function HomePage() {
  return (
    <div>
      <h1>KDone</h1>
      <p>
        Turn a book idea into a researched, structured, edited, production-ready Kindle book through
        one observable workflow, while keeping the author in control of final publication.
      </p>
      <p>
        <Link href="/dashboard">Open your dashboard</Link>
      </p>
    </div>
  );
}