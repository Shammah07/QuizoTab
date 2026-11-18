import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Old PHP addresses people may have bookmarked or shared keep working
  async redirects() {
    return [
      { source: "/index.php", destination: "/", permanent: true },
      { source: "/privacy.php", destination: "/privacy", permanent: true },
      { source: "/terms.php", destination: "/terms", permanent: true },
      { source: "/refund.php", destination: "/refund", permanent: true },
      { source: "/verify.php", destination: "/verify", permanent: true },
      { source: "/reset.php", destination: "/reset", permanent: true },
      { source: "/forgot.php", destination: "/forgot", permanent: true },
      { source: "/quiz/explore.php", destination: "/quiz/explore", permanent: true },
    ];
  },
};

export default nextConfig;
