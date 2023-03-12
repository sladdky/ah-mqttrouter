describe('blank', () => {
	const variable = true;

	beforeAll(() => {
		console.log('hi');
	});

	test('should be true', () => {
		expect(variable).toBeTruthy();
	});
});
