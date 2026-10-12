package com.eclms.esg.controller;

import com.eclms.esg.model.EsgAssessmentRequest;
import com.eclms.esg.model.EsgAssessmentResponse;
import com.eclms.esg.service.EsgAssessmentService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/assessment")
public class EsgAssessmentController {

    private final EsgAssessmentService assessmentService;

    public EsgAssessmentController(EsgAssessmentService assessmentService) {
        this.assessmentService = assessmentService;
    }

    @PostMapping("/calculate-score")
    public EsgAssessmentResponse calculateScore(@RequestBody EsgAssessmentRequest request) {
        return assessmentService.calculate(request);
    }

    @PostMapping("/submit")
    public EsgAssessmentResponse submit(@RequestBody EsgAssessmentRequest request) {
        return assessmentService.submit(request);
    }
}
