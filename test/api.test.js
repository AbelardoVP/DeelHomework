const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/model');

describe('API Tests', () => {
	beforeAll(async () => {
		await sequelize.authenticate();
	});

	describe('GET /contracts/:id', () => {
		it('should return the contract if it belongs to the profile calling', async () => {
			const profileId = 1;
			const contractId = 1;

			const res = await request(app)
				.get(`/contracts/${contractId}`)
				.set('profile_id', profileId);

			expect(res.status).toBe(200);
			expect(res.body).toHaveProperty('id', contractId);
		});

		it('should return 403 if the contract does not belong to the profile calling', async () => {
			const profileId = 2;
			const contractId = 1;

			const res = await request(app)
				.get(`/contracts/${contractId}`)
				.set('profile_id', profileId);

			expect(res.status).toBe(403);
		});
	});

	describe('GET /contracts', () => {
		it('should return a list of non-terminated contracts for the user', async () => {
			const profileId = 1;

			const res = await request(app)
				.get('/contracts')
				.set('profile_id', profileId);

			expect(res.status).toBe(200);
			expect(Array.isArray(res.body)).toBe(true);
			res.body.forEach(contract => {
				expect(contract.status).not.toBe('terminated');
			});
		});
	});

	describe('GET /jobs/unpaid', () => {
		it('should return all unpaid jobs for active contracts', async () => {
			const profileId = 1;

			const res = await request(app)
				.get('/jobs/unpaid')
				.set('profile_id', profileId);

			expect(res.status).toBe(200);
			expect(Array.isArray(res.body)).toBe(true);
			res.body.forEach(job => {
				expect(job.paid).toBe(false);
			});
		});
	});

	describe('POST /jobs/:job_id/pay', () => {

		it('should return 400 if client balance is insufficient', async () => {
			const profileId = 1;
			const jobId = 2;

			const res = await request(app)
				.post(`/jobs/${jobId}/pay`)
				.set('profile_id', profileId)
				.send({ amount: 5000 });

			expect(res.status).toBe(400);
			expect(res.body.message).toBe('Insufficient balance');
		});
	});

	describe('POST /balances/deposit/:userId', () => {

		it('should return 400 if deposit amount exceeds allowed limit', async () => {
			const profileId = 1; // Asegúrate de que este ID corresponda a un cliente existente con contratos en progreso

			const res = await request(app)
				.post(`/balances/deposit/${profileId}`)
				.set('profile_id', profileId)
				.send({ amount: 10000 });

			expect(res.status).toBe(400);
			expect(res.body.message).toContain('Deposit amount exceeds the maximum allowed');
		});
	});

	// describe('GET /admin/best-profession', () => {
	// 	it('should return the profession that earned the most money in the date range', async () => {
	// 		const res = await request(app)
	// 			.get('/admin/best-profession')
	// 			.query({ start: '2020-01-01', end: '2020-12-31' });

	// 		expect(res.status).toBe(200);
	// 		expect(res.body).toHaveProperty('profession');
	// 		expect(res.body).toHaveProperty('total_earned');
	// 	}, 10000);
	// });

	// describe('GET /admin/best-clients', () => {
	// 	it('should return the clients that paid the most in the date range', async () => {
	// 		const res = await request(app)
	// 			.get('/admin/best-clients')
	// 			.query({ start: '2020-01-01', end: '2020-12-31', limit: 2 });

	// 		expect(res.status).toBe(200);
	// 		expect(Array.isArray(res.body)).toBe(true);
	// 		expect(res.body.length).toBeLessThanOrEqual(2);
	// 		res.body.forEach(client => {
	// 			expect(client).toHaveProperty('id');
	// 			expect(client).toHaveProperty('fullName');
	// 			expect(client).toHaveProperty('paid');
	// 		});
	// 	}, 10000);
	// });
});
