'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button, ErrorText, inputClass } from '@/components/ui';
import { apiFetch, errorMessage } from '@/lib/client/api-client';

interface ImportResult {
  dryRun: boolean;
  importId?: string;
  counts: { rows: number; created: number; updated: number; skipped: number; errors: number };
  unknownColumns: string[];
  rows: {
    row: number;
    outcome: string;
    leadId?: string;
    errors?: { field: string; message: string }[];
  }[];
}

export function ImportForm() {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(dryRun: boolean) {
    setPending(true);
    setError(null);
    const res = await apiFetch<ImportResult>('/api/v1/imports', {
      method: 'POST',
      body: { csv, fileName, dryRun },
    });
    setPending(false);
    if (!res.ok || !res.data) {
      setResult(null);
      return setError(errorMessage(res.error));
    }
    setResult(res.data);
  }

  return (
    <div className="space-y-4">
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setFileName(file.name);
          setCsv(await file.text());
          setResult(null);
        }}
        className="text-sm"
      />
      <textarea
        value={csv}
        onChange={(e) => {
          setCsv(e.target.value);
          setResult(null);
        }}
        rows={8}
        placeholder="…or paste CSV here"
        className={`${inputClass} font-mono`}
      />
      <div className="flex gap-3">
        <Button
          type="button"
          variant="secondary"
          disabled={pending || !csv}
          onClick={() => submit(true)}
        >
          Preview
        </Button>
        <Button
          type="button"
          disabled={pending || !result?.dryRun}
          onClick={() => submit(false)}
          title={result?.dryRun ? undefined : 'Preview first'}
        >
          Import
        </Button>
      </div>
      <ErrorText message={error} />

      {result ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm">
          <p className="font-medium">
            {result.dryRun ? 'Preview — nothing saved yet.' : 'Import complete.'}{' '}
            {result.counts.rows} rows: {result.counts.created} new, {result.counts.updated} updated,{' '}
            {result.counts.skipped} skipped (do-not-contact), {result.counts.errors} errors.
          </p>
          {result.unknownColumns.length > 0 ? (
            <p className="mt-1 text-slate-500">
              Ignored columns: {result.unknownColumns.join(', ')}
            </p>
          ) : null}
          <table className="mt-3 w-full text-left">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-1">Row</th>
                <th className="py-1">Outcome</th>
                <th className="py-1">Details</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.slice(0, 200).map((row) => (
                <tr key={row.row} className="border-t border-slate-100">
                  <td className="py-1">{row.row}</td>
                  <td className="py-1">{row.outcome}</td>
                  <td className="py-1 text-slate-600">
                    {row.errors?.map((e) => `${e.field}: ${e.message}`).join('; ')}
                    {!result.dryRun && row.leadId ? (
                      <Link href={`/admin/leads/${row.leadId}`} className="text-brand">
                        open
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
