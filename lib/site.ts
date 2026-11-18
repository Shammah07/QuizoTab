// QuizoTab's public contact details, shown in the footer. Anything left empty is simply not shown.
// (Was contact.php on the PHP site.)
export const contact = {
  email: "quizotab01@gmail.com",
  // Phone number as people should see it
  phone: "+255 765 652 046 / +255 616 702 046",
  // WhatsApp number with country code, digits only. Turns on "Chat with us" in the footer.
  whatsapp: "255765652046",
  address: "Dar es Salaam Tanzania",
  socials: {
    instagram: "",
    tiktok: "",
    facebook: "",
    linkedin: "",
    x: "",
    youtube: "",
  },
} as const;

export const site = {
  name: "QuizoTab",
  title: "QuizoTab | Host live quiz tournaments with real-time standings",
  description:
    "Schools, universities, companies and communities run quiz tournaments and live quizzes on QuizoTab. Judges score from their phones, organisers approve every result, and players join live quizzes free with a PIN.",
  url: process.env.APP_URL ?? "http://localhost:3000",
} as const;
