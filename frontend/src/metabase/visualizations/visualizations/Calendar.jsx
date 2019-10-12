/* @flow */

import React, { Component } from "react";
import ReactDOM from "react-dom";
import { t } from "ttag";
import d3 from "d3";
import moment from "moment";
import cx from "classnames";

import _ from "underscore";

import {
  ChartSettingsError,
  MinRowsError,
} from "metabase/visualizations/lib/errors";
import CalendarWidget from "metabase/components/Calendar";
import { formatValue } from "metabase/lib/formatting";
import { isNumeric } from "metabase/lib/schema_metadata";
import { columnSettings } from "metabase/visualizations/lib/settings/column";
import { color, getColorsForValues } from "metabase/lib/colors";
import {
  metricSetting,
  dimensionSetting,
} from "metabase/visualizations/lib/settings/utils";

import ChartSettingCalendarSegments from "metabase/visualizations/components/settings/ChartSettingCalendar";
import InputBlurChange from "metabase/components/InputBlurChange";
import Icon from "metabase/components/Icon";
import ExpandingContent from "metabase/components/ExpandingContent";

import type { VisualizationProps } from "metabase/meta/types/Visualization";

import {
  GRAPH_DATA_SETTINGS,
  LINE_SETTINGS,
  GRAPH_GOAL_SETTINGS,
  GRAPH_COLORS_SETTINGS,
  GRAPH_AXIS_SETTINGS,
} from "../lib/settings/graph";

const MAX_WIDTH = 500;
const PADDING_BOTTOM = 10;
const DATE_FORMAT = "YYYY-MM-DD";
const DATE_TIME_FORMAT = "YYYY-MM-DDTHH:mm:ss";

const OUTER_RADIUS = 45; // within 100px SVG element
const INNER_RADIUS_RATIO = 3.7 / 5;
const INNER_RADIUS = OUTER_RADIUS * INNER_RADIUS_RATIO;

// arrow shape, currently an equilateral triangle
const ARROW_HEIGHT = ((OUTER_RADIUS - INNER_RADIUS) * 2.5) / 4; // 2/3 of segment thickness
const ARROW_BASE = ARROW_HEIGHT / Math.tan((64 / 180) * Math.PI);
const ARROW_STROKE_THICKNESS = 1.25;

// colors
const BACKGROUND_ARC_COLOR = color("bg-medium");
const SEGMENT_LABEL_COLOR = color("text-dark");
const CENTER_LABEL_COLOR = color("text-dark");
const ARROW_FILL_COLOR = color("text-medium");
const ARROW_STROKE_COLOR = "white";

// in ems, but within the scaled 100px SVG element
const FONT_SIZE_SEGMENT_LABEL = 0.25;
const FONT_SIZE_CENTER_LABEL_MIN = 0.5;
const FONT_SIZE_CENTER_LABEL_MAX = 0.7;

// hide labels if SVG width is smaller than this
const MIN_WIDTH_LABEL_THRESHOLD = 250;

const LABEL_OFFSET_PERCENT = 1.025;

// total degrees of the arc (180 = semicircle, etc)
const ARC_DEGREES = 180 + 45 * 2; // semicircle plus a bit

const radians = degrees => (degrees * Math.PI) / 180;
const degrees = radians => (radians * 180) / Math.PI;

const segmentIsValid = s => !isNaN(s.min) && !isNaN(s.max);

export default class Calendar extends Component {
  props: VisualizationProps;

  static uiName = t`Calendar`;
  static identifier = "calendar";
  static iconName = "calendar";

  static minSize = { width: 4, height: 4 };

  static isSensible({ cols, rows }) {
    return cols.length === 2;
  }

  static checkRenderable(
    [
      {
        data: { cols, rows },
      },
    ],
    settings,
  ) {
    // This prevents showing "Which columns do you want to use" when
    // the piechart is displayed with no results in the dashboard
    if (rows.length < 1) {
      throw new MinRowsError(1, 0);
    }
    if (!settings["calendar.dimension"] || !settings["calendar.metric"]) {
      throw new ChartSettingsError(t`Which columns do you want to use?`, {
        section: `Data`,
      });
    }
  }

  state = {
    mounted: false,
  };

  _label: ?HTMLElement;

  static settings = {
    ...columnSettings({ hidden: true }),
    ...dimensionSetting("calendar.dimension", {
      section: t`Data`,
      title: t`Dimension`,
      showColumnSetting: true,
    }),
    ...metricSetting("calendar.metric", {
      section: t`Data`,
      title: t`Measure`,
      showColumnSetting: true,
    }),
    "calendar.from_start_not_end": {
      section: t`Display`,
      title: t`Show from Starting Month`,
      widget: "toggle",
      default: true
    },
    "calendar._metricIndex": {
      getValue: (
        [
          {
            data: { cols },
          },
        ],
        settings,
      ) => _.findIndex(cols, col => col.name === settings["calendar.metric"]),
      readDependencies: ["calendar.metric"],
    },
    "calendar._dimensionIndex": {
      getValue: (
        [
          {
            data: { cols },
          },
        ],
        settings,
      ) => _.findIndex(cols, col => col.name === settings["calendar.dimension"]),
      readDependencies: ["calendar.dimension"],
    },
    "calendar._dimensionValues": {
      getValue: (
        [
          {
            data: { rows },
          },
        ],
        settings,
      ) => {
        const dimensionIndex = settings["calendar._dimensionIndex"];
        return dimensionIndex >= 0
          ? // cast to string because getColorsForValues expects strings
            rows.map(row => String(row[dimensionIndex]))
          : null;
      },
      readDependencies: ["calendar._dimensionIndex"],
    },
  };

  componentDidMount() {
    this.setState({ mounted: true });
    this._updateLabelSize();
  }
  componentDidUpdate() {
    this._updateLabelSize();
  }

  _updateLabelSize() {
    // TODO: extract this into a component that resizes SVG <text> element to fit bounds
    const label = this._label && ReactDOM.findDOMNode(this._label);
    if (label) {
      const { width: currentWidth } = label.getBBox();
      // maxWidth currently 95% of inner diameter, could be more intelligent based on text aspect ratio
      const maxWidth = INNER_RADIUS * 2 * 0.95;
      const currentFontSize = parseFloat(
        label.style.fontSize.replace("em", ""),
      );
      // scale the font based on currentWidth/maxWidth, within min and max
      // TODO: if text is too big wrap or ellipsis?
      const desiredFontSize = Math.max(
        FONT_SIZE_CENTER_LABEL_MIN,
        Math.min(
          FONT_SIZE_CENTER_LABEL_MAX,
          currentFontSize * (maxWidth / currentWidth),
        ),
      );
      // don't resize if within 5% to avoid potential thrashing
      if (Math.abs(1 - currentFontSize / desiredFontSize) > 0.05) {
        label.style.fontSize = desiredFontSize + "em";
      }
    }
  }

  render() {
    const {
      series: [
        {
          data: { rows, cols },
        },
      ],
      settings,
      className,
      isSettings,
    } = this.props;

    const width = this.props.width;
    const height = this.props.height - PADDING_BOTTOM;
    const calendar = true;
    const hideTimeSelectors = true;

    const viewBoxHeight =
      (ARC_DEGREES > 180 ? 50 : 0) + Math.sin(radians(ARC_DEGREES / 2)) * 50;
    const viewBoxWidth = 100;

    const svgAspectRatio = viewBoxHeight / viewBoxWidth;
    const containerAspectRadio = height / width;

    let svgWidth;
    if (containerAspectRadio < svgAspectRatio) {
      svgWidth = Math.min(MAX_WIDTH, height / svgAspectRatio);
    } else {
      svgWidth = Math.min(MAX_WIDTH, width);
    }
    const svgHeight = svgWidth * svgAspectRatio;

    const showLabels = svgWidth > MIN_WIDTH_LABEL_THRESHOLD;

    const range = settings["calendar.range"];

    const value = rows[0][0];
    const column = cols[0];
    const dimensionIndex = settings["calendar._dimensionIndex"];
    const metricIndex = settings["calendar._metricIndex"];

    const { showCalendar } = this.state;

    let date, hours, minutes;
    if (moment(value, DATE_TIME_FORMAT, true).isValid()) {
      date = moment(value, DATE_TIME_FORMAT, true);
      hours = date.hours();
      minutes = date.minutes();
      date.startOf("day");
    } else if (moment(value, DATE_FORMAT, true).isValid()) {
      date = moment(value, DATE_FORMAT, true);
    } else {
      date = moment();
    }

    const max: number = rows.reduce((max, row) => (max > row[metricIndex] ? max : row[metricIndex]), 0);
    const min: number = rows.reduce((min, row) => (min < row[metricIndex] ? min : row[metricIndex]), 0);
    const maxDate: number = rows.reduce((max, row) => (max > row[dimensionIndex] ? max : row[dimensionIndex]), 0);
    const minDate: number = rows.reduce((min, row) => (min < row[dimensionIndex] ? min : row[dimensionIndex]), 0);

    const dates = rows.reduce((dates, row) => {
      const date = moment(row[dimensionIndex]).toString();
      if (!(date in dates)) {
        dates[date] = 0;
      }

      dates[date] += row[metricIndex];

      return dates
    }, {});

    const binsh = d3.layout.histogram()
      .value((entry) => entry[1])
      .range([min, max])
      .bins(10)(Object.entries(dates));

    const bins = binsh.reduce((bins, bin, ix) => {
      bin.forEach((entry) => { bins[entry[0]] = ix });
      return bins;
    }, {});
    console.log(bins, minDate, maxDate);

    const initial =
      settings["calendar.from_start_not_end"]
        ? moment(minDate)
        : moment(maxDate);
    console.log(initial);

    return (
      <div className={cx(className, "relative")}>
            <CalendarWidget
              selected={initial}
              initial={initial}
              bins={bins}
              onChange={value => this.onChange(value, hours, minutes)}
              isRangePicker={false}
            />
      </div>
    );
  }
}
