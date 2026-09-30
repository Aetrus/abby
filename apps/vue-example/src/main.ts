import { AbbyEventType, HttpService } from "@tryabby/core";
import { createApp, defineComponent, h, ref, watch } from "vue";
import { abby, initialData } from "./abby";
import "./style.css";

type RecordedEvent = {
  id: number;
  type: "PING" | "ACT";
  variant: string;
};
const events = ref<RecordedEvent[]>([]);
let eventId = 0;

// DEMO INSTRUMENTATION ONLY: record the SDK's event calls without delivering them.
// The stock HttpService already suppresses events on localhost. Intercepting here
// also makes preview on 127.0.0.1 or another host completely offline.
HttpService.sendData = ({ type, data }) => {
  const event: RecordedEvent = {
    id: ++eventId,
    type: type === AbbyEventType.PING ? "PING" : "ACT",
    variant: data.selectedVariant,
  };
  events.value = [event, ...events.value].slice(0, 12);
  return undefined;
};

const TestedButton = defineComponent({
  name: "TestedButton",
  setup() {
    const { variant, onAct } = abby.useAbby("checkout", {
      control: { label: "Start checkout", tone: "control" },
      treatment: { label: "Try fast checkout", tone: "treatment" },
    });
    const suffix = abby.useRemoteConfig("buttonSuffix");
    const client = abby.useAbbyClient();
    return () =>
      h(
        "button",
        {
          type: "button",
          class: `experiment ${variant.value.tone}`,
          disabled: !client.isReady.value,
          onClick: onAct,
          "data-testid": "experiment-button",
        },
        `${variant.value.label} · ${suffix.value}`
      );
  },
});

const Playground = defineComponent({
  name: "Playground",
  setup() {
    const client = abby.useAbbyClient();
    const betaDashboard = abby.useFeatureFlag("betaDashboard");
    const showBanner = abby.useFeatureFlag("showBanner");
    const welcome = abby.useRemoteConfig("welcomeText");
    const beta = ref(false);
    const mounted = ref(true);
    const remoteText = ref("Local demo");
    watch(beta, (isBeta) => client.updateUserProperties({ isBeta }), {
      immediate: true,
    });

    return () =>
      h("div", { class: "playground" }, [
        h("section", { class: "card" }, [
          h("p", { class: "eyebrow" }, "Reactive values"),
          h("h2", { "data-testid": "welcome" }, welcome.value),
          h(
            "p",
            { "data-testid": "targeted-flag" },
            `Beta dashboard: ${betaDashboard.value ? "enabled" : "disabled"}`
          ),
          showBanner.value
            ? h(
                "p",
                { class: "banner", "data-testid": "banner" },
                "A local feature-flag banner is visible"
              )
            : null,
          mounted.value
            ? h(TestedButton)
            : h(
                "p",
                { class: "placeholder" },
                "Experiment component is unmounted"
              ),
          h(
            "p",
            { class: "note" },
            "The button label is a typed A/B lookup. Click it to call onAct()."
          ),
        ]),
        h("section", { class: "card controls" }, [
          h("p", { class: "eyebrow" }, "Try the integration"),
          h("h2", "Local controls"),
          h("label", { class: "toggle" }, [
            h("input", {
              type: "checkbox",
              checked: beta.value,
              "data-testid": "targeting-toggle",
              onChange: (event: Event) => {
                beta.value = (event.target as HTMLInputElement).checked;
              },
            }),
            "Target as a beta tester",
          ]),
          h("label", { class: "toggle" }, [
            h("input", {
              type: "checkbox",
              checked: client.cookiesEnabled.value,
              "data-testid": "consent-toggle",
              onChange: (event: Event) => {
                if ((event.target as HTMLInputElement).checked)
                  client.enableCookies();
                else client.disableCookies();
              },
            }),
            "Allow A/B cookies and event calls",
          ]),
          h(
            "p",
            { class: "note", "data-testid": "readiness" },
            `Mounted data ready: ${client.isReady.value}. Consent: ${client.cookiesEnabled.value ? "on" : "off"}.`
          ),
          h("div", { class: "button-row" }, [
            h(
              "button",
              {
                type: "button",
                onClick: () =>
                  client.abby.updateLocalVariant("checkout", "control"),
                "data-testid": "override-control",
              },
              "Use control"
            ),
            h(
              "button",
              {
                type: "button",
                onClick: () =>
                  client.abby.updateLocalVariant("checkout", "treatment"),
                "data-testid": "override-treatment",
              },
              "Use treatment"
            ),
          ]),
          h(
            "button",
            {
              type: "button",
              "data-testid": "override-flag",
              onClick: () =>
                client.abby.updateFlag("showBanner", !showBanner.value),
            },
            "Toggle local feature flag"
          ),
          h("label", { class: "text-field" }, [
            "Remote button text",
            h("input", {
              type: "text",
              value: remoteText.value,
              "data-testid": "remote-text-input",
              onInput: (event: Event) => {
                remoteText.value = (event.target as HTMLInputElement).value;
              },
            }),
          ]),
          h(
            "button",
            {
              type: "button",
              "data-testid": "override-remote",
              onClick: () =>
                client.abby.updateRemoteConfig(
                  "buttonSuffix",
                  remoteText.value
                ),
            },
            "Apply local remote config"
          ),
          h(
            "button",
            {
              type: "button",
              "data-testid": "mount-toggle",
              onClick: () => {
                mounted.value = !mounted.value;
              },
            },
            mounted.value ? "Unmount experiment" : "Mount experiment"
          ),
        ]),
      ]);
  },
});

const App = defineComponent({
  name: "App",
  setup() {
    return () =>
      h("main", [
        h("header", [
          h("p", { class: "eyebrow" }, "Abby + Vue 3"),
          h("h1", "Feature management, made reactive"),
          h(
            "p",
            "A deterministic, offline demo with fixture data. No account, paid API, or backend needed."
          ),
        ]),
        h(abby.AbbyProvider, { initialData }, { default: () => h(Playground) }),
        h("section", { class: "card event-card", "aria-live": "polite" }, [
          h("div", { class: "event-heading" }, [
            h("h2", "Local event-call log"),
            h(
              "button",
              {
                type: "button",
                onClick: () => {
                  events.value = [];
                },
              },
              "Clear log"
            ),
          ]),
          h(
            "p",
            { class: "note" },
            "Demo-only interception records PING exposures and ACT clicks. These calls are not sent to Abby. Consent is off initially."
          ),
          events.value.length
            ? h(
                "ol",
                { "data-testid": "event-log" },
                events.value.map((event) =>
                  h(
                    "li",
                    { key: event.id },
                    `${event.type} · checkout · ${event.variant}`
                  )
                )
              )
            : h(
                "p",
                { "data-testid": "empty-events" },
                "No event calls recorded"
              ),
        ]),
      ]);
  },
});

createApp(App).mount("#app");
