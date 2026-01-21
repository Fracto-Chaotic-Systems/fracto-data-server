<?php

if (!file_exists(__DIR__ . '/request')) {
    mkdir(__DIR__ . '/request', 0777, true);
}
if (!file_exists(__DIR__ . '/response')) {
    mkdir(__DIR__ . '/response', 0777, true);
}