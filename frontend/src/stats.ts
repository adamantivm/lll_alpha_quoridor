import "./app.css";
import { mount } from "svelte";
import StatsApp from "./StatsApp.svelte";

const app = mount(StatsApp, { target: document.getElementById("app")! });
export default app;
