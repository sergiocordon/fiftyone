/**
 * Copyright 2017-2021, Voxel51, Inc.
 */

import { NUM_ROWS_PER_SECTION } from "./constants";
import SectionElement from "./section";
import {
  Get,
  ItemData,
  onItemClick,
  Optional,
  Options,
  Render,
  RowData,
  State,
} from "./state";

import { flashlight } from "./styles.module.css";
import tile from "./tile";

export interface FlashlightOptions extends Optional<Options> {}

export interface FlashlightConfig<K> {
  get: Get<K>;
  render: Render;
  initialRequestKey: K;
  options: FlashlightOptions;
  onItemClick?: onItemClick;
}

export default class Flashlight<K> {
  private loading: boolean = false;
  private container: HTMLDivElement = document.createElement("div");
  private state: State<K>;
  private intersectionObserver: IntersectionObserver;
  private resizeObserver: ResizeObserver;
  private readonly config: FlashlightConfig<K>;
  private lastScrollTop: number;

  constructor(config: FlashlightConfig<K>) {
    this.config = config;
    this.container.classList.add(flashlight);
    this.state = this.getEmptyState(config);
    this.setObservers();
    this.get();
    this.lastScrollTop = 0;

    let attached = false;

    this.resizeObserver = new ResizeObserver(
      ([
        {
          contentRect: { width },
        },
      ]: ResizeObserverEntry[]) => {
        if (!attached) {
          attached = true;
          return;
        }

        this.reposition(width);
      }
    );
  }

  reset() {
    this.intersectionObserver && this.intersectionObserver.disconnect();
    this.setObservers();
    const newContainer = document.createElement("div");
    newContainer.classList.add(flashlight);
    this.container.replaceWith(newContainer);
    this.container = newContainer;
    this.state = this.getEmptyState(this.config);

    const {
      width,
      height,
    } = this.container.parentElement.getBoundingClientRect();
    this.state.width = width - 16;
    this.state.containerHeight = height;

    this.get();
  }

  isAttached() {
    return Boolean(this.container.parentElement);
  }

  attach(element: HTMLElement | string): void {
    if (typeof element === "string") {
      element = document.getElementById(element);
    }

    const { width, height } = element.getBoundingClientRect();
    this.state.width = width - 16;
    this.state.containerHeight = height;

    element.appendChild(this.container);

    this.resizeObserver.observe(element);
  }

  updateOptions(options: Optional<Options>) {
    const retile = Object.entries(options).some(
      ([k, v]) => this.state.options[k] != v
    );

    this.state.options = {
      ...this.state.options,
      ...options,
    };

    if (retile) {
      requestAnimationFrame(() => {
        this.intersectionObserver && this.intersectionObserver.disconnect();
        this.setObservers();
        const newContainer = document.createElement("div");
        newContainer.classList.add(flashlight);
        this.container.replaceWith(newContainer);
        this.container = newContainer;
        const items = [
          ...this.state.sections.map((section) => section.getItems()).flat(),
          ...this.state.currentRowRemainder.map(({ items }) => items).flat(),
        ];
        let sections = this.tile(items);

        const lastSection = sections[sections.length - 1];
        if (
          Boolean(this.state.currentRequestKey) &&
          lastSection.length !== NUM_ROWS_PER_SECTION
        ) {
          this.state.currentRowRemainder = lastSection;
          sections = sections.slice(0, -1);

          sections.length === 0 && this.get();
        } else {
          this.state.currentRowRemainder = [];
        }

        this.state.height = 0;
        this.state.sections = [];
        this.state.shownSections = new Set();
        this.state.clean = new Set();

        sections.forEach((rows) => {
          const sectionElement = new SectionElement(
            this.state.sections.length,
            rows,
            this.state.render,
            this.getOnItemClick()
          );
          sectionElement.set(
            this.state.height,
            this.state.width,
            this.state.options.margin
          );
          this.state.sections.push(sectionElement);
          this.intersectionObserver.observe(sectionElement.target);
          newContainer.appendChild(sectionElement.target);

          this.state.height += sectionElement.getHeight();
        });

        newContainer.style.height = `${this.state.height}px`;
      });
    }
  }

  updateItems(updater: (id: string) => void) {
    requestAnimationFrame(() => {
      this.state.clean = new Set();
      this.state.shownSections.forEach((index) => {
        const section = this.state.sections[index];
        section
          .getItems()
          .map(({ id }) => id)
          .forEach((id) => updater(id));
      });
      this.state.updater = updater;
    });
  }

  private get() {
    if (this.loading || this.state.currentRequestKey === null) {
      return;
    }

    this.loading = true;
    this.state
      .get(this.state.currentRequestKey)
      .then(({ items, nextRequestKey }) => {
        this.state.currentRequestKey = nextRequestKey;

        items = [...this.state.currentRemainder, ...items];

        let sections = this.tile(items, true);

        const lastSection = sections[sections.length - 1];
        if (
          Boolean(nextRequestKey) &&
          lastSection &&
          lastSection.length !== NUM_ROWS_PER_SECTION
        ) {
          this.state.currentRowRemainder = lastSection;
          sections = sections.slice(0, -1);

          sections.length === 0 && this.get();
        } else {
          this.state.currentRowRemainder = [];
        }
        sections.forEach((rows) => {
          const sectionElement = new SectionElement(
            this.state.sections.length,
            rows,
            this.state.render,
            this.getOnItemClick()
          );
          sectionElement.set(
            this.state.height,
            this.state.width,
            this.state.options.margin
          );
          this.state.sections.push(sectionElement);
          this.intersectionObserver.observe(sectionElement.target);
          this.container.appendChild(sectionElement.target);

          this.state.height += sectionElement.getHeight();
          this.state.clean.add(sectionElement.index);
        });

        if (sections.length) {
          this.container.style.height = `${this.state.height}px`;
        }

        this.state.currentRequestKey = nextRequestKey;
        this.loading = false;

        const headSection = this.state.sections[this.state.sections.length - 1];

        if (
          this.state.height <= this.state.containerHeight ||
          (!sections.length && nextRequestKey) ||
          (headSection && this.state.shownSections.has(headSection.index))
        ) {
          this.get();
        }
      });
  }

  private setObservers() {
    const showSection = (index: number) => {
      const section = this.state.sections[index];
      if (!section || section.isShown()) {
        return;
      }

      if (!this.state.clean.has(section.index)) {
        this.state.updater &&
          section
            .getItems()
            .map(({ id }) => id)
            .forEach((id) => this.state.updater(id));
      }
      section.show();
      this.state.shownSections.add(section.index);
    };

    const hideSection = (index: number) => {
      const section = this.state.sections[index];
      if (!section || !section.isShown()) {
        return;
      }

      section.hide();
      this.state.shownSections.delete(section.index);
    };

    const clearOutsideSections = () => {
      [...this.state.shownSections].forEach((index) => {
        if (
          index < this.state.activeSection ||
          index > this.state.lastSection
        ) {
          hideSection(index);
        }
      });
    };

    const requestMore = () => {
      if (
        this.state.currentRequestKey &&
        this.state.lastSection >= this.state.sections.length - 2
      ) {
        this.get();
      }
    };

    const finalize = () => {
      clearOutsideSections();
      requestMore();
    };

    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        requestAnimationFrame(() => {
          const currentScrollTop = this.container.parentElement.scrollTop;

          const down = this.lastScrollTop <= currentScrollTop;

          for (const { target, intersectionRatio } of entries) {
            const section = this.state.sections[
              parseInt((target as HTMLDivElement).dataset.index, 10)
            ];
            if (intersectionRatio) {
              showSection(section.index);
              this.state.shownSections.add(section.index);
            }

            if (down && this.state.shownSections.has(section.index)) {
              let revealing = section;
              let revealingIndex = section.index;

              while (
                revealingIndex > 0 &&
                revealing.getTop() >= currentScrollTop
              ) {
                revealingIndex--;
                revealing = this.state.sections[revealingIndex];
              }

              revealingIndex = Math.max(0, revealingIndex - 1);
              revealing = this.state.sections[revealingIndex];

              this.state.activeSection = revealingIndex;

              do {
                showSection(revealingIndex);
                revealingIndex = revealing.index + 1;
                revealing = this.state.sections[revealingIndex];
              } while (
                revealing &&
                revealing.getTop() <=
                  currentScrollTop + this.state.containerHeight
              );

              this.state.lastSection = !revealing
                ? revealingIndex - 1
                : revealingIndex;
              showSection(this.state.lastSection);

              finalize();
              break;
            } else if (!down && this.state.shownSections.has(section.index)) {
              let revealing = section;
              let revealingIndex = section.index;

              while (
                revealingIndex > 0 &&
                revealing.getTop() <=
                  currentScrollTop + this.state.containerHeight
              ) {
                revealingIndex++;
                revealing = this.state.sections[revealingIndex];
              }

              revealingIndex = Math.min(
                this.state.sections.length - 1,
                revealingIndex + 1
              );
              revealing = this.state.sections[revealingIndex];

              this.state.lastSection = revealingIndex;

              do {
                showSection(revealingIndex);
                revealingIndex = revealing.index - 1;
                revealing = this.state.sections[revealingIndex];
              } while (
                revealing &&
                revealing.getTop() + revealing.getHeight() >= currentScrollTop
              );

              this.state.activeSection = !revealing
                ? revealingIndex + 1
                : revealingIndex;
              showSection(this.state.activeSection);

              finalize();
              break;
            }
          }

          this.lastScrollTop = currentScrollTop;
        });
      },
      {
        root: this.container.parentElement,
        threshold: 0,
      }
    );
  }

  private tile(items: ItemData[], useRowRemainder = false): RowData[][] {
    let { rows, remainder } = tile(
      items,
      this.state.options.rowAspectRatioThreshold,
      Boolean(this.state.currentRequestKey)
    );

    for (const { items: i } of rows) {
      for (const { id } of i) {
        this.state.itemIndexMap[id] = this.state.nextItemIndex;
        this.state.nextItemIndex++;
      }
    }

    this.state.currentRemainder = remainder;

    if (useRowRemainder) {
      rows = [...this.state.currentRowRemainder, ...rows];
    }

    return new Array(Math.ceil(rows.length / NUM_ROWS_PER_SECTION))
      .fill(0)
      .map((_) => rows.splice(0, NUM_ROWS_PER_SECTION));
  }

  private reposition(width: number) {
    requestAnimationFrame(() => {
      const activeSection = this.state.sections[this.state.activeSection];
      if (width === this.state.width) {
        return;
      }

      this.state.width = width;
      let height = 0;
      this.state.sections.forEach((section) => {
        section.set(height, width, this.state.options.margin);
        height += section.getHeight();
      });

      this.container.style.height = `${height}px`;
      activeSection.target.scrollTo();
      this.lastScrollTop = activeSection.getTop();
    });
  }

  private getEmptyState(config: FlashlightConfig<K>): State<K> {
    return {
      currentRequestKey: config.initialRequestKey,
      containerHeight: null,
      width: null,
      height: 0,
      ...config,
      currentRemainder: [],
      currentRowRemainder: [],
      items: [],
      sections: [],
      activeSection: 0,
      lastSection: 0,
      options: {
        rowAspectRatioThreshold: 5,
        margin: 3,
        ...config.options,
      },
      clean: new Set(),
      shownSections: new Set(),
      onItemClick: config.onItemClick,
      itemIndexMap: {},
      nextItemIndex: 0,
    };
  }

  private getOnItemClick(): (event: MouseEvent, id: string) => void | null {
    if (!this.state.onItemClick) {
      return null;
    }

    return (event, id) =>
      this.state.onItemClick(event, id, { ...this.state.itemIndexMap });
  }
}