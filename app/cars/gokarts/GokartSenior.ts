import type { Track } from "~/tracks/Track";
import { Car } from "../Car";

export class GokartSenior extends Car {
    public width = 17;
    public height = 22;
    public speed = 0; // km/h
    public acceleration = 25; // km/h
    public deceleration = 14; // km/h
    public brakeDeceleration = 50; // km/h
    public maxSpeed = 125; // km/h
    public rotationSpeed = 300; // degrees per second
    public horsePower = 28;

    constructor(track: Track) {
        super(track);
    }
}