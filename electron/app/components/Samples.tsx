import _ from "lodash";
import React, { createRef, useState, useRef, useEffect } from "react";
import { Card, Grid } from "semantic-ui-react";
import InfiniteScroll from "react-infinite-scroller";
import { Dimmer, Loader } from "semantic-ui-react";

import ImagePit from "./ImagePit";
import Sample from "./Sample";
import { getSocket, useSubscribe } from "../utils/socket";
import connect from "../utils/connect";

function Samples(props) {
  const { displayProps, state, setView, port, dispatch } = props;
  const socket = getSocket(port, "state");
  const initialSelected = state.selected.reduce((obj, id, i) => {
    return {
      ...obj,
      [id]: true,
    };
  }, {});
  const [selected, setSelected] = useState(initialSelected);
  const [scrollState, setScrollState] = useState({
    initialLoad: true,
    hasMore: true,
    imageGroups: [],
    imagePits: [],
    pageToLoad: 1,
  });
  const loadMore = () => {
    socket.emit("page", scrollState.pageToLoad, (data) => {
      setScrollState({
        initialLoad: false,
        hasMore: scrollState.pageToLoad * 20 < state.count,
        imagePits: [...scrollState.imagePits, data],
        imageGroups: [...scrollState.imageGroups, null],
        pageToLoad: scrollState.pageToLoad + 1,
      });
    });
  };

  useSubscribe(socket, "update", (data) => {
    setScrollState({
      iniitialLoad: true,
      hasMore: true,
      imageGroups: [],
      imagePits: [],
      pageToLoad: 1,
    });
  });

  const fitImages = (groups) => {
    let imgs = {};
    console.log(groups);
    for (const i in groups) {
      console.log(i);
    }
  };

  fitImages(scrollState.imageGroups);

  const chunkedImages = _.chunk(scrollState.images, 4);
  const content = chunkedImages.map((imgs, i) => {
    return (
      <>
        {imgs.map((img, j) => {
          return (
            <Grid.Column key={j}>
              <Sample
                displayProps={displayProps}
                sample={img}
                selected={selected}
                setSelected={setSelected}
                setView={setView}
              />
            </Grid.Column>
          );
        })}
      </>
    );
  });
  console.log(scrollState.imagePits);
  return (
    <>
      {scrollState.imagePits.map((p, i) => (
        <ImagePit images={p} index={i} setScrollState={setScrollState} />
      ))}
      <InfiniteScroll
        pageStart={1}
        initialLoad={true}
        loadMore={() => loadMore()}
        hasMore={false}
        loader={<Loader key={0} />}
        useWindow={true}
      >
        <Grid columns={4} doubling stackable>
          {null}
        </Grid>
      </InfiniteScroll>
      {scrollState.hasMore ? <Loader /> : ""}
    </>
  );
}

export default connect(Samples);
