/**
 * Copyright 2017-2021, Voxel51, Inc.
 */

import { SELECTION_TEXT } from "../../constants";
import { BaseState } from "../../state";
import { BaseElement, Events } from "../base";

import { looker, lookerFullscreen } from "./looker.module.css";

export class LookerElement<State extends BaseState> extends BaseElement<
  State,
  HTMLDivElement
> {
  private selection: boolean;
  getEvents(): Events<State> {
    return {
      keydown: ({ event, update, dispatchEvent }) => {
        if (event.altKey || event.ctrlKey || event.metaKey) {
          return;
        }

        const e = event as KeyboardEvent;
        update(({ SHORTCUTS }) => {
          if (e.key in SHORTCUTS) {
            SHORTCUTS[e.key].action(update, dispatchEvent, e.key);
          }

          return {};
        });
      },
      mouseenter: ({ update, dispatchEvent }) => {
        dispatchEvent("mouseenter");
        update(({ config: { thumbnail } }) => {
          if (thumbnail) {
            return { hovering: true };
          }
          return {
            hovering: true,
            showControls: true,
          };
        });
      },
      mouseleave: ({ update, dispatchEvent }) => {
        dispatchEvent("mouseleave");
        update({
          hovering: false,
          disableControls: false,
          showControls: false,
          showOptions: false,
          panning: false,
        });
      },
    };
  }

  createHTMLElement() {
    const element = document.createElement("div");
    element.classList.add(looker);
    element.tabIndex = -1;
    return element;
  }

  renderSelf({
    hovering,
    config: { thumbnail },
    options: { fullscreen, inSelectionMode },
  }: Readonly<State>) {
    if (!thumbnail && hovering && this.element !== document.activeElement) {
      this.element.focus();
    }

    const fullscreenClass = this.element.classList.contains(lookerFullscreen);
    if (fullscreen && !fullscreenClass) {
      this.element.classList.add(lookerFullscreen);
    } else if (!fullscreen && fullscreenClass) {
      this.element.classList.remove(lookerFullscreen);
    }

    if (thumbnail && inSelectionMode !== this.selection) {
      this.selection = inSelectionMode;
      this.element.title = inSelectionMode ? SELECTION_TEXT : "Click to expand";
    }

    return this.element;
  }
}
