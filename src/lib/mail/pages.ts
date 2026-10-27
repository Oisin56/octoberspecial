/**
 * Every row, a page at a time: the database hands back at most 1,000 rows a request, so a list of thousands (an
 * audience, a night's evening emails) is read in pages. `page(from, to)` must sort by something unique so no row is
 * skipped or read twice.
 */
export async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error?: { message: string } | null }>, size = 1000, max = 500_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < size) break;
  }
  return out;
}
