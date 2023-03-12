import { IClientPublishOptions, IPublishPacket, MqttClient, PacketCallback } from 'mqtt';

export class UndefinedResponseTopicError extends Error {}

export type MqttRequest = { topic: string; rawPayload: Buffer; payload: MqttPayload; packet: IPublishPacket };

export type MqttResponse = {
	getTopic: () => string;
	setTopic: (topic: string) => void;
	send: (message: string) => void;
};
export type MqttNext = () => void;
export type MqttRouteCallback = (request: MqttRequest, response: MqttResponse, next: MqttNext) => void;
export type MqttRoute = {
	topic: string;
	callback: MqttRouteCallback | MqttRouteCallback[];
};

export type MqttSubscription = {
	topic: string;
	topicAsRegex: RegExp;
	callback: MqttRouteCallback | MqttRouteCallback[];
};

export type MqttRouterOptions = {
	routes: MqttRoute[];
};

type BaseType = string | number | undefined;
type MqttPayload = BaseType | Record<string, string | number | undefined> | MqttPayload[];

export type MqttTransformPayloadReturnType = {
	payload: MqttPayload;
	responseTopic: string;
	isPayloadInvalid: boolean;
};

export class MqttRouter {
	_mqttClient: MqttClient;
	options: MqttRouterOptions;
	_subscriptions: MqttSubscription[];

	constructor(mqttClient: MqttClient, options: Partial<MqttRouterOptions> = {}) {
		this.options = {
			routes: [],
			...options,
		};

		this._mqttClient = mqttClient;
		this._subscriptions = [];
		this.options.routes.forEach((route) => {
			this.subscribe(route.topic, route.callback);
		});
	}

	subscribe(topic: string, callback: MqttRouteCallback | MqttRouteCallback[]) {
		const subscription = this._subscriptions.find(
			(subscription) => subscription.callback === callback && subscription.topic === topic
		);
		if (subscription) {
			return;
		}

		const topicAsRegex = new RegExp(topic.replace('+', '[^/]+').replace('#', '.*'));
		this._subscriptions.push({
			topic,
			topicAsRegex,
			callback,
		});
		this._mqttClient.subscribe(topic);

		if (this._subscriptions.length === 1) {
			this._mqttClient.addListener('message', this._handleMessage);
		}
	}

	unsubscribe(topic: string, callback: MqttRouteCallback) {
		const index = this._subscriptions.findIndex(
			(subscription) => subscription.callback === callback && subscription.topic === topic
		);
		if (!~index) {
			return;
		}

		this._subscriptions.splice(index, 1);

		if (this._subscriptions.length === 0) {
			this._mqttClient.removeListener('message', this._handleMessage);
		}
	}

	publish(
		topic: string,
		message: string | Buffer,
		opts: IClientPublishOptions = {},
		callback?: PacketCallback | undefined
	) {
		return this._mqttClient.publish(topic, message, opts, callback);
	}

	_handleMessage = (topic: string, rawPayload: Buffer, packet: IPublishPacket) => {
		const stack = this._subscriptions
			.filter((subscription) => {
				return subscription.topicAsRegex.test(topic);
			})
			.reduce<MqttRouteCallback[]>((acc, subscription) => {
				return [...acc, ...(Array.isArray(subscription.callback) ? subscription.callback : [subscription.callback])];
			}, []);

		const { payload, responseTopic } = transformPayloadFnc(rawPayload);

		const createRequest = (): MqttRequest => {
			return {
				topic,
				rawPayload,
				payload,
				packet,
			};
		};

		const createResponse = (): MqttResponse => {
			let _topic = responseTopic;
			let _isSent = false;

			return {
				getTopic: () => {
					return _topic;
				},
				setTopic: (topic: string) => {
					_topic = topic;
				},
				send: (message: string) => {
					if (!_topic) {
						throw new UndefinedResponseTopicError(
							`Cannot send response. Either call setTopic() manually or send it with a request.`
						);
					}

					if (_isSent) {
						return;
					}

					this._mqttClient.publish(_topic, message);
					_isSent = true;
				},
			};
		};

		const _request = createRequest();
		const _response = createResponse();

		const next = (request: MqttRequest = _request, response: MqttResponse = _response) => {
			const callback = stack.shift();
			if (!callback) {
				//request unhandled by routes
				return;
			}
			callback(request, response, next);
		};

		next();
	};
}

function transformPayloadFnc(rawPayload: Buffer): MqttTransformPayloadReturnType {
	let isPayloadInvalid = false;
	let responseTopic = '';
	let payload: MqttPayload = rawPayload.toString();

	if (payload !== '') {
		try {
			payload = JSON.parse(payload);
			if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
				responseTopic = `${payload.responseTopic}`;
				payload = JSON.parse(`${payload.message}`);
			}
		} catch (error) {
			isPayloadInvalid = true;
		}
	}

	return {
		payload,
		isPayloadInvalid,
		responseTopic,
	};
}
