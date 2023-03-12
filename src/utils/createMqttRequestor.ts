import { MqttRequest, MqttRouter } from '../MqttRouter';

export function createMqttRequestor(mqttRouter: MqttRouter) {
	return {
		send: (topic: string, message: string, responseTopic?: string) =>
			sendMqttRequestResponse(mqttRouter, topic, message, responseTopic),
	};
}

export function sendMqttRequestResponse(
	mqttRouter: MqttRouter,
	topic: string,
	message: string,
	responseTopic = `response/${Math.floor(Math.random() * 10000).toString()}`
) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			mqttRouter.unsubscribe(responseTopic, onResponse);
			reject(`Request timed out after 5000 ms`);
		}, 5000);

		const onResponse = (req: MqttRequest) => {
			clearTimeout(timer);
			mqttRouter.unsubscribe(responseTopic, onResponse);
			resolve(req);
		};
		mqttRouter.subscribe(responseTopic, onResponse);
		mqttRouter.publish(
			topic,
			JSON.stringify({
				responseTopic,
				message,
			})
		);
	});
}
