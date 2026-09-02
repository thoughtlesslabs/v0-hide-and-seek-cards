import type { CapacitorConfig } from "@capacitor/cli"

const config: CapacitorConfig = {
  appId: "com.thoughtlesslabs.hideandseekcards",
  appName: "Hide & Seek Cards",
  webDir: "dist",
  loggingBehavior: "none",
  backgroundColor: "#120a18",
  android: {
    allowMixedContent: false,
    backgroundColor: "#120a18",
    webContentsDebuggingEnabled: false,
  },
  ios: {
    allowsLinkPreview: false,
    backgroundColor: "#120a18",
    contentInset: "never",
    preferredContentMode: "mobile",
  },
  server: {
    hostname: "localhost",
    androidScheme: "https",
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 1_200,
      backgroundColor: "#120a18",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#120a18",
      overlaysWebView: true,
    },
  },
}

export default config
