/* @flow */

import React, { Component } from "react";
import PropTypes from "prop-types";

import EmbedFrame from "./EmbedFrame";

const PublicNotFound = () =>
    <EmbedFrame className="spread">
        <div className="flex layout-centered flex-full flex-column">
            <div className="QueryError-image QueryError-image--noRows"></div>
            <div className="mt1 h4 sm-h3 md-h2 text-bold">
                Not found
            </div>
        </div>
    </EmbedFrame>;

export default PublicNotFound;
