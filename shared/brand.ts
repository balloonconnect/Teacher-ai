/** The product's name and wording, in one place. Change it here (and in index.html / public/manifest.webmanifest, which are static files). Internal identifiers (database file, demo logins, Docker names) are deliberately not renamed. */
export const BRAND = {
  appName: 'Karkai AI',
  appNameTamil: 'கற்கை AI',
  productDescription: 'Your Personal AI Teacher',
  productDescriptionTamil: 'உங்கள் தனிப்பட்ட AI ஆசிரியர்',
  tagline: 'கேட்டு கற்போம். பார்த்துப் புரிந்துகொள்வோம்.',
  taglineEnglish: 'Learn by Listening. Understand by Seeing.',
  pageTitle: 'Karkai AI — Your Personal AI Teacher',
  metaDescription: 'Learn step by step with Karkai AI. Ask questions, listen to explanations, explore visual references, and learn in Tamil, English, or both.',
  /** Sent as the User-Agent when the tutor reads a web page a student adds. */
  botName: 'KarkaiBot',
} as const;
