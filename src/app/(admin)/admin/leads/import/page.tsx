import { requirePageUser } from '@/lib/admin-session';
import { ImportForm } from './import-form';

export const metadata = { title: 'Import leads · ProfitCosmos Omega' };

export default async function ImportPage() {
  await requirePageUser('admin');
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Import leads from CSV</h1>
      <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
        <p>
          The first row must be a header. Recognised columns: <code>name</code>, <code>email</code>,{' '}
          <code>phone</code> (international format), <code>country</code> (2-letter code),{' '}
          <code>source</code> / <code>utm_source</code>, <code>medium</code>, <code>campaign</code>,{' '}
          <code>experience</code> (beginner / intermediate / experienced), <code>markets</code>{' '}
          (separated by <code>;</code>), <code>marketing_email_consent</code> (yes / no). Other
          columns are ignored. Every row needs an email or a phone number.
        </p>
        <p className="mt-2">
          Rows matching an existing lead (same email or phone) update it without overwriting
          existing values. Contacts on the do-not-contact list are skipped. Always preview first.
        </p>
      </div>
      <ImportForm />
    </div>
  );
}
