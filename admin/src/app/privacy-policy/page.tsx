import type { Metadata } from 'next';

const APP_NAME = '[Your App Name]';
const LAST_UPDATED = '9 October 2026';

export const metadata: Metadata = {
  title: { absolute: `Privacy Policy · ${APP_NAME}` },
};

type Item = string | { label: string; text: string };
type Block = { p: string } | { list: Item[] };

interface Section {
  title: string;
  blocks: Block[];
}

const SECTIONS: Section[] = [
  {
    title: '1. Introduction',
    blocks: [
      {
        p: `Welcome to ${APP_NAME} (“we,” “our,” or “us”). We provide cricket-related information, including live scores, match schedules, scorecards, ball-by-ball updates, team statistics, player information, and push notifications.`,
      },
      {
        p: 'This Privacy Policy explains how we collect, use, store, and protect information when you use our mobile application or website.',
      },
      { p: 'By using our services, you acknowledge that you have read this Privacy Policy.' },
    ],
  },
  {
    title: '2. Information We Collect',
    blocks: [
      { p: 'Depending on how you use the application and the permissions you grant, we may collect the following information:' },
      {
        list: [
          { label: 'Device information', text: 'Device identifier, device platform, operating system, and application version.' },
          {
            label: 'Push notification information',
            text: 'Firebase Cloud Messaging (FCM) token used to deliver match alerts and other notifications.',
          },
          {
            label: 'Usage and technical information',
            text: 'App activity, timestamps, crash reports, and diagnostic information, where enabled.',
          },
          { label: 'Support information', text: 'Information you voluntarily provide when contacting us.' },
        ],
      },
      { p: 'Our application does not require users to create an account or provide a password if account functionality is not offered.' },
      {
        p: 'We do not intentionally collect precise GPS location, contact lists, photos, or microphone recordings unless a future feature specifically requires such access and appropriate permission is obtained.',
      },
    ],
  },
  {
    title: '3. How We Use Information',
    blocks: [
      { p: 'We may use collected information to:' },
      {
        list: [
          'Provide live cricket scores, scorecards, and match updates.',
          'Deliver notifications about matches and other relevant cricket events.',
          'Maintain and improve application performance.',
          'Diagnose technical errors and prevent misuse.',
          'Understand aggregate usage and application reliability.',
          'Respond to support requests.',
          'Maintain the security and stability of our services.',
        ],
      },
      { p: 'We collect and use information only for purposes consistent with providing and maintaining the application.' },
    ],
  },
  {
    title: '4. Live Cricket Data and Third-Party Services',
    blocks: [
      {
        p: 'Our application may obtain cricket information from third-party sports data providers, including providers such as GoalServe, EntitySport, Sportmonks, or other providers selected by us.',
      },
      {
        p: 'These providers supply cricket-related information such as live scores, ball-by-ball updates, player statistics, fixtures, and scorecards.',
      },
      {
        p: 'We may also use Firebase Cloud Messaging to deliver push notifications and other infrastructure providers to host and operate our services.',
      },
      {
        p: 'These third-party providers may process information according to their own privacy policies and contractual terms. Please review their policies where applicable.',
      },
    ],
  },
  {
    title: '5. Push Notifications',
    blocks: [
      {
        p: 'If you enable push notifications, we may store your FCM token and associated device information to send match alerts and service notifications.',
      },
      {
        p: 'You can disable notifications through your device settings. Disabling notifications may prevent you from receiving live-match alerts.',
      },
      { p: 'FCM tokens may change. We may update the token associated with your device to ensure notifications continue to work correctly.' },
    ],
  },
  {
    title: '6. Cookies and Analytics',
    blocks: [
      {
        p: 'Our website or application may use cookies, analytics tools, or similar technologies where implemented to maintain functionality, understand usage, and improve our services.',
      },
      {
        p: 'If analytics or advertising technologies are introduced, we will update this policy as appropriate and provide any required notices or choices.',
      },
    ],
  },
  {
    title: '7. Sharing of Information',
    blocks: [
      { p: "We do not sell users' personal information to third parties." },
      { p: 'We may share limited information with:' },
      {
        list: [
          {
            label: 'Service providers',
            text: 'Hosting, infrastructure, diagnostics, and notification providers needed to operate the application.',
          },
          { label: 'Sports data providers', text: 'To obtain and deliver cricket-related information, where applicable.' },
          { label: 'Legal authorities', text: 'Where disclosure is required by applicable law or a valid legal process.' },
          {
            label: 'Security and fraud-prevention services',
            text: 'Where reasonably necessary to protect our application, users, and infrastructure.',
          },
        ],
      },
      { p: 'We aim to limit sharing to information necessary for the relevant purpose.' },
    ],
  },
  {
    title: '8. Data Storage and Security',
    blocks: [
      {
        p: 'We use reasonable technical and organisational measures to protect information against unauthorised access, loss, misuse, alteration, or disclosure.',
      },
      {
        p: 'Information may be stored on our servers or on infrastructure managed by authorised service providers. We retain information only for as long as reasonably necessary for the purposes described in this policy or as required by applicable law.',
      },
      { p: 'No electronic storage or transmission method can be guaranteed to be completely secure.' },
    ],
  },
  {
    title: '9. Data Retention and Deletion',
    blocks: [
      {
        p: 'We retain device information and notification tokens for as long as they are needed to provide the service, maintain security, and fulfil applicable legal obligations.',
      },
      {
        p: 'You may request deletion of information associated with your device by contacting us at the email address below. We may need limited information to verify and process your request.',
      },
      {
        p: 'Some information may be retained for a longer period where required by law or necessary to resolve security, legal, or operational issues.',
      },
    ],
  },
  {
    title: '10. Your Privacy Choices and Rights',
    blocks: [
      { p: 'Depending on applicable law, you may have the right to:' },
      {
        list: [
          'Request information about personal data we hold about you.',
          'Request correction of inaccurate information.',
          'Request deletion of personal data.',
          'Withdraw consent where processing is based on consent.',
          'Disable push notifications through your device settings.',
          'Raise a privacy concern or complaint.',
        ],
      },
      { p: 'To exercise these rights, contact us using the details in the Contact Us section.' },
    ],
  },
  {
    title: "11. Children's Privacy",
    blocks: [
      {
        p: 'Our application is not specifically designed to collect personal information from children. If you believe a child has provided personal information inappropriately, contact us so that we can review the matter and take appropriate action.',
      },
      { p: 'Where applicable law requires parental consent or additional safeguards, we will follow those requirements.' },
    ],
  },
  {
    title: '12. International Data Transfers',
    blocks: [
      {
        p: 'Our service providers may process information in countries other than your country of residence. Where applicable, we will take steps required by relevant data protection laws concerning such transfers.',
      },
    ],
  },
  {
    title: '13. Changes to This Privacy Policy',
    blocks: [
      { p: 'We may update this Privacy Policy when our services, data practices, or legal obligations change.' },
      {
        p: 'We will publish the updated version on this page and revise the “Last Updated” date. Where required, we will provide additional notice or obtain consent.',
      },
    ],
  },
];

function ListItem({ item }: { item: Item }) {
  if (typeof item === 'string') {
    return <li>{item}</li>;
  }
  return (
    <li>
      <span className="font-medium text-slate-900">{item.label}:</span> {item.text}
    </li>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-white px-4 py-10 sm:py-16">
      <article className="mx-auto max-w-3xl">
        <header className="border-b border-slate-200 pb-6">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Privacy Policy</h1>
          <p className="mt-2 text-sm text-slate-500">Last Updated: {LAST_UPDATED}</p>
        </header>

        {SECTIONS.map((section) => (
          <section key={section.title} className="mt-8">
            <h2 className="text-lg font-semibold text-slate-900">{section.title}</h2>
            <div className="mt-3 space-y-3 text-[15px] leading-7 text-slate-700">
              {section.blocks.map((block, index) =>
                'p' in block ? (
                  <p key={index}>{block.p}</p>
                ) : (
                  <ul key={index} className="list-disc space-y-1.5 pl-6">
                    {block.list.map((item) => (
                      <ListItem key={typeof item === 'string' ? item : item.label} item={item} />
                    ))}
                  </ul>
                ),
              )}
            </div>
          </section>
        ))}
      </article>
    </main>
  );
}
